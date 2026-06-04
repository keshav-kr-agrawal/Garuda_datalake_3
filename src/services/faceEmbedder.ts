import { Platform } from 'react-native';
import { loadTensorflowModel } from 'react-native-fast-tflite';

// Threshold for face verification matching (Similarity >= 0.72)
export const SIMILARITY_THRESHOLD = 0.72;

export interface FaceMeshResult {
  landmarks: number[][]; // 468 points, each [x, y, z]
}

export type ModelRuntimeMode = 'native-tflite' | 'geometric-fallback' | 'unloaded';

export interface FaceEmbedderStatus {
  loaded: boolean;
  faceMeshLoaded: boolean;
  mobileFaceNetLoaded: boolean;
  mode: ModelRuntimeMode;
  warnings: string[];
}

// ─── Phone-style multi-angle face model ───────────────────────────────────────
// Stores one embedding per enrollment angle, plus a weighted master vector.
export interface AngleEmbedding {
  step: string;           // e.g. 'LOOK_CENTER', 'TURN_LEFT'
  embedding: number[];    // L2-normalized 128-D vector (stored as plain array)
  poseYaw: number;
  posePitch: number;
  poseRoll: number;
  capturedAt: number;     // epoch ms
}

export interface FaceModel {
  userId: string;
  angleEmbeddings: AngleEmbedding[];
  /**
   * Weighted composite of all angle embeddings.
   * Center view gets 2× weight; all others 1×.
   * This is what gets compared during fast detection.
   */
  masterEmbedding: number[];
  enrolledAt: number;
  version: number;        // increment if user re-enrolls
}

export class FaceEmbedderService {
  private static instance: FaceEmbedderService;
  private faceMeshModel: any = null;
  private mobileFaceNetModel: any = null;
  private isLoaded = false;
  private warnings: string[] = [];

  private constructor() {}

  public static getInstance(): FaceEmbedderService {
    if (!FaceEmbedderService.instance) {
      FaceEmbedderService.instance = new FaceEmbedderService();
    }
    return FaceEmbedderService.instance;
  }

  /**
   * Initializes the AI models by loading them from local assets.
   * Delegates execution to NNAPI (Android) or Metal/GPU (iOS) if available.
   */
  public async initialize(): Promise<boolean> {
    if (this.isLoaded) return true;

    try {
      console.log('[FaceEmbedderService] Initializing Edge AI models...');
      this.warnings = [];

      // In a real device environment, react-native-fast-tflite loads from the asset path
      // On Android: assets/face_mesh.tflite, iOS: bundle files
      const meshPath = Platform.OS === 'android' ? 'face_mesh.tflite' : 'assets/face_mesh.tflite';
      const faceNetPath = Platform.OS === 'android' ? 'mobile_facenet.tflite' : 'assets/mobile_facenet.tflite';

      try {
        this.faceMeshModel = await loadTensorFlowModel(meshPath, {
          delegate: Platform.OS === 'ios' ? 'metal' : 'nnapi',
        });
        console.log('[FaceEmbedderService] MediaPipe Face Mesh model loaded successfully.');
      } catch (err) {
        const warning = 'Native Face Mesh model was not loaded. Landmark input must come from another offline pipeline.';
        console.warn(`[FaceEmbedderService] ${warning}`, err);
        this.warnings.push(warning);
        this.faceMeshModel = null;
      }

      try {
        this.mobileFaceNetModel = await loadTensorFlowModel(faceNetPath, {
          delegate: Platform.OS === 'ios' ? 'metal' : 'nnapi',
        });
        console.log('[FaceEmbedderService] MobileFaceNet model loaded successfully.');
      } catch (err) {
        const warning = 'Native MobileFaceNet model was not loaded. Falling back to deterministic landmark geometry only.';
        console.warn(`[FaceEmbedderService] ${warning}`, err);
        this.warnings.push(warning);
        this.mobileFaceNetModel = null;
      }

      this.isLoaded = true;
      return true;
    } catch (error) {
      console.error('[FaceEmbedderService] Fatal error initializing AI models:', error);
      return false;
    }
  }

  public getStatus(): FaceEmbedderStatus {
    const faceMeshLoaded = !!this.faceMeshModel;
    const mobileFaceNetLoaded = !!this.mobileFaceNetModel;
    const mode: ModelRuntimeMode = mobileFaceNetLoaded
      ? 'native-tflite'
      : this.isLoaded
      ? 'geometric-fallback'
      : 'unloaded';

    return {
      loaded: this.isLoaded,
      faceMeshLoaded,
      mobileFaceNetLoaded,
      mode,
      warnings: [...this.warnings],
    };
  }

  public isNativeRecognitionReady(): boolean {
    return this.getStatus().mobileFaceNetLoaded;
  }

  /**
   * Synchronous frame processor entry point — called from the Vision Camera worklet thread.
   *
   * Pipeline:
   *   1. Extract raw RGBA/NV21 pixel bytes from the Vision Camera Frame
   *   2. Crop center square region from the frame
   *   3. Bilinear downsample to MobileFaceNet input: 112×112×3
   *   4. Normalize pixels [0,255] → [-1.0, +1.0] (MobileFaceNet convention)
   *   5. Run react-native-fast-tflite runSync() → 128-D embedding
   *   6. L2 normalize the output vector
   *
   * Returns null if the TFLite model is not loaded.
   * The caller (frame processor in CameraScanner) falls back to geometric signature.
   */
  public generateEmbeddingFromFrame(frame: any): Float32Array | null {
    if (!this.mobileFaceNetModel || this.mobileFaceNetModel.mock) {
      return null;
    }
    try {
      const frameBuffer = frame.toArrayBuffer() as ArrayBuffer;
      const rawBytes = new Uint8Array(frameBuffer);
      const frameW: number = frame.width;
      const frameH: number = frame.height;
      const inputSize = 112;
      const inputTensor = new Float32Array(inputSize * inputSize * 3);

      const cropX = Math.max(0, Math.floor((frameW - frameH) / 2));
      const cropSize = Math.min(frameW, frameH);
      const stepX = cropSize / inputSize;
      const stepY = cropSize / inputSize;
      const bytesPerPixel = rawBytes.length / (frameW * frameH);
      const isBGRA = bytesPerPixel >= 4;

      for (let y = 0; y < inputSize; y++) {
        for (let x = 0; x < inputSize; x++) {
          const srcX = Math.min(frameW - 1, Math.floor(cropX + x * stepX));
          const srcY = Math.min(frameH - 1, Math.floor(y * stepY));
          const srcIdx = (srcY * frameW + srcX) * Math.floor(bytesPerPixel);
          let r: number, g: number, b: number;
          if (isBGRA) {
            b = rawBytes[srcIdx] ?? 0;
            g = rawBytes[srcIdx + 1] ?? 0;
            r = rawBytes[srcIdx + 2] ?? 0;
          } else {
            const luma = rawBytes[srcIdx] ?? 0;
            r = luma; g = luma; b = luma;
          }
          const outIdx = (y * inputSize + x) * 3;
          inputTensor[outIdx]     = (r - 128) / 128;
          inputTensor[outIdx + 1] = (g - 128) / 128;
          inputTensor[outIdx + 2] = (b - 128) / 128;
        }
      }

      // react-native-fast-tflite v3 synchronous inference
      const output = this.mobileFaceNetModel.runSync([inputTensor]);
      return this.l2Normalize(new Float32Array(output[0]));
    } catch (err) {
      console.warn('[FaceEmbedderService] Frame processor inference error:', err);
      return null;
    }
  }

  /**
   * Generates a 128-dimensional embedding vector for an aligned face image buffer.
   * Performs real-time INT8 quantized model inference.
   */
  public async generateEmbedding(faceImageBuffer: Float32Array): Promise<Float32Array> {
    if (!this.isLoaded) {
      await this.initialize();
    }

    // High performance model execution
    if (this.mobileFaceNetModel) {
      try {
        // Execute fast JNI C++ frame buffer inference
        const output = await this.mobileFaceNetModel.run([faceImageBuffer]);
        const rawVector = new Float32Array(output[0]);
        return this.l2Normalize(rawVector);
      } catch (e) {
        console.error('[FaceEmbedderService] Error running MobileFaceNet inference:', e);
      }
    }

    // Deterministic fallback for simulator/demo continuity only. It is not a
    // substitute for MobileFaceNet accuracy and is exposed via getStatus().
    console.log('[FaceEmbedderService] Using deterministic fallback embedding.');
    const mockVector = new Float32Array(128);
    for (let i = 0; i < 128; i++) {
      // Deterministic generation based on input properties to make it testable
      mockVector[i] = Math.sin(i + faceImageBuffer.length) * Math.cos(i * 2.3);
    }
    return this.l2Normalize(mockVector);
  }

  /**
   * Landmark-only fallback used when a live FaceMesh path is available but the
   * MobileFaceNet delegate is not. It encodes 128 normalized nose-relative 3D
   * distances. This is useful for an offline demo, but CNN embeddings should be
   * used for the final >95% recognition claim.
   */
  public generateGeometrySignature(
    landmarks: { x: number; y: number; z: number }[]
  ): Float32Array {
    const vector = new Float32Array(128);
    const origin = landmarks[1];

    for (let i = 0; i < 128; i++) {
      const targetIdx = landmarks.length ? (i * 3 + 17) % landmarks.length : -1;
      const pt = targetIdx >= 0 ? landmarks[targetIdx] : null;
      if (pt && origin) {
        const dx = pt.x - origin.x;
        const dy = pt.y - origin.y;
        const dz = pt.z - origin.z;
        vector[i] = Math.sqrt(dx * dx + dy * dy + dz * dz);
      } else {
        vector[i] = 1.0;
      }
    }

    return this.l2Normalize(vector);
  }

  /**
   * Mathematical L2 Normalization of a vector:
   * u_hat = u / ||u||_2
   */
  public l2Normalize(vector: Float32Array): Float32Array {
    let sumSquares = 0;
    for (let i = 0; i < vector.length; i++) {
      sumSquares += vector[i] * vector[i];
    }
    
    const magnitude = Math.sqrt(sumSquares);
    if (magnitude === 0) return vector;

    const normalized = new Float32Array(vector.length);
    for (let i = 0; i < vector.length; i++) {
      normalized[i] = vector[i] / magnitude;
    }
    return normalized;
  }

  /**
   * Fast Cosine Similarity execution utilizing dot-product multiplication.
   * Since vectors are L2-normalized on generation, this simplifies to:
   * Sim(u, v) = sum(u_i * v_i)
   */
  public compareEmbeddings(embeddingA: Float32Array, embeddingB: Float32Array): number {
    if (embeddingA.length !== embeddingB.length) {
      throw new Error(`Embedding dimensional mismatch: ${embeddingA.length} vs ${embeddingB.length}`);
    }

    let dotProduct = 0;
    for (let i = 0; i < embeddingA.length; i++) {
      dotProduct += embeddingA[i] * embeddingB[i];
    }
    
    return dotProduct;
  }

  /**
   * Verifies if two face embeddings are a match based on our empirical similarity threshold.
   */
  public verifyMatch(embeddingA: Float32Array, embeddingB: Float32Array): { match: boolean; confidence: number } {
    const similarity = this.compareEmbeddings(embeddingA, embeddingB);
    return {
      match: similarity >= SIMILARITY_THRESHOLD,
      confidence: similarity,
    };
  }

  // ─── Phone-style Multi-Angle Methods ───────────────────────────────────────

  /**
   * Builds a single master embedding from multiple angle captures.
   * The center (LOOK_CENTER) view gets 2x weight to prioritize
   * the canonical frontal face representation.
   *
   * Steps:
   *   1. Weighted sum across all angle embeddings
   *   2. L2-normalize the result so it stays unit magnitude
   */
  public buildMasterEmbedding(
    angleEmbeddings: { step: string; embedding: Float32Array }[]
  ): Float32Array {
    const dim = 128;
    const master = new Float32Array(dim);
    let totalWeight = 0;

    for (const { step, embedding } of angleEmbeddings) {
      const weight = step === 'LOOK_CENTER' ? 2.0 : 1.0;
      for (let i = 0; i < dim; i++) {
        master[i] += embedding[i] * weight;
      }
      totalWeight += weight;
    }

    // Divide by total weight, then L2-normalize
    for (let i = 0; i < dim; i++) {
      master[i] /= totalWeight;
    }
    return this.l2Normalize(master);
  }

  /**
   * Fast 1:N detection against a list of enrolled face models.
   * Compares the live embedding against each model's masterEmbedding.
   * Also checks individual angle embeddings to improve recall when
   * the user's current head angle matches a stored angle.
   *
   * Returns the best matching model and its similarity score.
   */
  public detectFace(
    liveEmbedding: Float32Array,
    models: { userId: string; masterEmbedding: Float32Array; angleEmbeddings?: { step: string; embedding: Float32Array }[] }[]
  ): { match: boolean; userId: string | null; confidence: number; matchedAngle: string } {
    const t0 = performance.now();
    let bestUserId: string | null = null;
    let bestSimilarity = -1;
    let bestAngle = 'master';

    for (const model of models) {
      // 1. Check master embedding first
      const masterSim = this.compareEmbeddings(liveEmbedding, model.masterEmbedding);
      if (masterSim > bestSimilarity) {
        bestSimilarity = masterSim;
        bestUserId = model.userId;
        bestAngle = 'master';
      }

      // 2. Also check each angle sub-embedding for better angle-specific recall
      if (model.angleEmbeddings) {
        for (const { step, embedding } of model.angleEmbeddings) {
          const angleSim = this.compareEmbeddings(liveEmbedding, embedding);
          if (angleSim > bestSimilarity) {
            bestSimilarity = angleSim;
            bestUserId = model.userId;
            bestAngle = step;
          }
        }
      }
    }

    return {
      match: bestSimilarity >= SIMILARITY_THRESHOLD,
      userId: bestUserId,
      confidence: bestSimilarity,
      matchedAngle: bestAngle,
    };
  }
}
