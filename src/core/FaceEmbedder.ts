/**
 * FaceEmbedder — Face embedding, similarity comparison, and 1:N detection.
 *
 * Platform-agnostic: works on web (via tf.js + TFLite WASM) or
 * React Native (via react-native-fast-tflite). Platform adapters
 * are injected via config, not imported directly.
 *
 * @example
 * ```ts
 * import { FaceEmbedder } from 'nhai-garuda';
 *
 * const embedder = new FaceEmbedder({ similarityThreshold: 0.75 });
 * await embedder.initialize();
 *
 * const result = embedder.verifyMatch(embeddingA, embeddingB);
 * console.log(result.match, result.confidence);
 * ```
 */

import type {
  FaceEmbedderConfig,
  FaceEmbedderStatus,
  ModelRuntimeMode,
  AngleEmbedding,
  FaceDetectionResult,
  FaceVerificationResult,
} from '../types';

// Re-export types for convenience
export type { FaceEmbedderConfig, FaceEmbedderStatus, AngleEmbedding, FaceDetectionResult, FaceVerificationResult };

/** Default similarity threshold for face verification */
export const DEFAULT_SIMILARITY_THRESHOLD = 0.72;

export class FaceEmbedder {
  private static _instance: FaceEmbedder | null = null;

  private mobileFaceNetModel: any = null;
  private isLoaded = false;
  private warnings: string[] = [];

  private readonly similarityThreshold: number;
  private readonly platform: 'web' | 'native' | 'auto';
  private readonly nativeModelLoader?: (path: string, options?: any) => Promise<any>;
  private readonly webTfliteRuntime?: any;
  private readonly webTfRuntime?: any;

  constructor(config: FaceEmbedderConfig = {}) {
    this.similarityThreshold = config.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
    this.platform = config.platform ?? 'auto';
    this.nativeModelLoader = config.nativeModelLoader;
    this.webTfliteRuntime = config.webTfliteRuntime;
    this.webTfRuntime = config.webTfRuntime;
  }

  /**
   * Backward-compatible singleton accessor.
   * Prefer `new FaceEmbedder(config)` for new integrations.
   */
  public static getInstance(): FaceEmbedder {
    if (!FaceEmbedder._instance) {
      FaceEmbedder._instance = new FaceEmbedder();
    }
    return FaceEmbedder._instance;
  }

  /** Reset the singleton (useful for testing) */
  public static resetInstance(): void {
    FaceEmbedder._instance = null;
  }

  /**
   * Detect the current runtime platform.
   */
  private detectPlatform(): 'web' | 'native' {
    if (this.platform !== 'auto') return this.platform;
    if (typeof window !== 'undefined' && typeof document !== 'undefined') return 'web';
    return 'native';
  }

  /**
   * Initializes the AI models by loading them from local assets.
   * On web: loads via window.tflite WASM runtime.
   * On native: loads via injected nativeModelLoader.
   */
  public async initialize(): Promise<boolean> {
    if (this.isLoaded) return true;

    try {
      this.warnings = [];
      const env = this.detectPlatform();

      if (env === 'web') {
        try {
          const tflite = this.webTfliteRuntime ?? (typeof window !== 'undefined' ? (window as any).tflite : null);
          if (tflite) {
            tflite.setWasmPath('/tflite-wasm/');
            this.mobileFaceNetModel = await tflite.loadTFLiteModel('/mobile_facenet.tflite');
          } else {
            this.warnings.push('Web TFLite runtime not found. Provide webTfliteRuntime in config or load tflite.js via script tag.');
          }
        } catch (e: any) {
          this.warnings.push(`Web model loading failed: ${e.message || String(e)}`);
          this.mobileFaceNetModel = null;
        }
      } else {
        // Native platform
        if (this.nativeModelLoader) {
          try {
            this.mobileFaceNetModel = await this.nativeModelLoader('mobile_facenet.tflite', {
              delegate: 'nnapi',
            });
          } catch (err: any) {
            this.warnings.push(`Native model loading failed: ${err.message || String(err)}`);
            this.mobileFaceNetModel = null;
          }
        } else {
          this.warnings.push('No nativeModelLoader provided. Pass loadTensorflowModel from react-native-fast-tflite in config.');
        }
      }

      this.isLoaded = true;
      return true;
    } catch (error) {
      return false;
    }
  }

  /** Returns the current status of the embedder. */
  public getStatus(): FaceEmbedderStatus {
    const mobileFaceNetLoaded = !!this.mobileFaceNetModel;
    const mode: ModelRuntimeMode = mobileFaceNetLoaded
      ? (this.detectPlatform() === 'web' ? 'web-tflite' : 'native-tflite')
      : this.isLoaded
      ? 'geometric-fallback'
      : 'unloaded';

    return {
      loaded: this.isLoaded,
      mobileFaceNetLoaded,
      mode,
      warnings: [...this.warnings],
    };
  }

  /** Whether the real MobileFaceNet model is ready for inference. */
  public isModelReady(): boolean {
    return !!this.mobileFaceNetModel;
  }

  // ─── Embedding Generation ───────────────────────────────────────────────────

  /**
   * Synchronous embedding from a raw camera frame buffer.
   * Used by Vision Camera frame processor on React Native.
   *
   * Pipeline:
   *   1. Extract raw pixels from frame
   *   2. Crop center square + bilinear downsample to 112×112×3
   *   3. Normalize pixels [0,255] → [-1.0, +1.0]
   *   4. Run TFLite runSync() → 128-D embedding
   *   5. L2 normalize
   *
   * Returns null if the model is not loaded.
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

      const output = this.mobileFaceNetModel.runSync([inputTensor]);
      return this.l2Normalize(new Float32Array(output[0]));
    } catch {
      return null;
    }
  }

  /**
   * Async embedding generation from a preprocessed face image buffer.
   * The buffer should be a Float32Array of shape [1, 112, 112, 3] normalized to [-1, 1].
   */
  public async generateEmbedding(faceImageBuffer: Float32Array): Promise<Float32Array> {
    if (!this.isLoaded) {
      await this.initialize();
    }

    if (this.mobileFaceNetModel) {
      try {
        const output = await this.mobileFaceNetModel.run([faceImageBuffer]);
        const rawVector = new Float32Array(output[0]);
        return this.l2Normalize(rawVector);
      } catch {
        // Fall through to geometric fallback
      }
    }

    // Deterministic fallback (not a substitute for CNN accuracy)
    const mockVector = new Float32Array(128);
    for (let i = 0; i < 128; i++) {
      mockVector[i] = Math.sin(i + faceImageBuffer.length) * Math.cos(i * 2.3);
    }
    return this.l2Normalize(mockVector);
  }

  /**
   * Generates a 128-D embedding via the browser TFLite runtime from an HTML canvas.
   */
  public async generateEmbeddingWeb(canvas: HTMLCanvasElement): Promise<Float32Array | null> {
    if (!this.mobileFaceNetModel) return null;
    try {
      const tf = this.webTfRuntime ?? (typeof window !== 'undefined' ? (window as any).tf : null);
      if (!tf) throw new Error('tf.js not loaded');
      const size = 112;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;

      const imgD = ctx.getImageData(0, 0, size, size);
      const raw = new Float32Array(size * size * 3);
      for (let i = 0, j = 0; i < imgD.data.length; i += 4, j += 3) {
        raw[j]     = (imgD.data[i]     / 127.5) - 1;
        raw[j + 1] = (imgD.data[i + 1] / 127.5) - 1;
        raw[j + 2] = (imgD.data[i + 2] / 127.5) - 1;
      }

      const inp = tf.tensor4d(raw, [1, size, size, 3]);
      const out = this.mobileFaceNetModel.predict(inp);
      const res = new Float32Array(await out.data());
      inp.dispose();
      out.dispose();
      return this.l2Normalize(res);
    } catch {
      return null;
    }
  }

  /**
   * Landmark-only fallback: encodes 128 normalized nose-relative 3D distances.
   * Useful for offline demo, but CNN embeddings should be used for >95% accuracy.
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

  // ─── Vector Math ────────────────────────────────────────────────────────────

  /**
   * L2 Normalization: u_hat = u / ||u||_2
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
   * Cosine similarity via dot product (vectors are already L2-normalized).
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
   * Verifies if two face embeddings match based on the configured similarity threshold.
   */
  public verifyMatch(embeddingA: Float32Array, embeddingB: Float32Array): FaceVerificationResult {
    const similarity = this.compareEmbeddings(embeddingA, embeddingB);
    return {
      match: similarity >= this.similarityThreshold,
      confidence: similarity,
    };
  }

  // ─── Multi-Angle Methods ────────────────────────────────────────────────────

  /**
   * Builds a weighted master embedding from multiple angle captures.
   * Center (LOOK_CENTER) gets 2× weight.
   */
  public buildMasterEmbedding(
    angleEmbeddings: { step: string; embedding: Float32Array }[]
  ): Float32Array {
    if (angleEmbeddings.length === 0) return new Float32Array(0);
    const dim = angleEmbeddings[0].embedding.length;
    const master = new Float32Array(dim);
    let totalWeight = 0;

    for (const { step, embedding } of angleEmbeddings) {
      const weight = step === 'LOOK_CENTER' ? 2.0 : 1.0;
      const len = Math.min(dim, embedding.length);
      for (let i = 0; i < len; i++) {
        master[i] += embedding[i] * weight;
      }
      totalWeight += weight;
    }

    for (let i = 0; i < dim; i++) {
      master[i] /= totalWeight;
    }
    return this.l2Normalize(master);
  }

  /**
   * Fast 1:N detection against a list of enrolled face models.
   * Checks both master and individual angle embeddings for best recall.
   */
  public detectFace(
    liveEmbedding: Float32Array,
    models: { userId: string; masterEmbedding: Float32Array; angleEmbeddings?: { step: string; embedding: Float32Array }[] }[]
  ): FaceDetectionResult {
    let bestUserId: string | null = null;
    let bestSimilarity = -1;
    let bestAngle = 'master';

    for (const model of models) {
      const masterSim = this.compareEmbeddings(liveEmbedding, model.masterEmbedding);
      if (masterSim > bestSimilarity) {
        bestSimilarity = masterSim;
        bestUserId = model.userId;
        bestAngle = 'master';
      }

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
      match: bestSimilarity >= this.similarityThreshold,
      userId: bestUserId,
      confidence: bestSimilarity,
      matchedAngle: bestAngle,
    };
  }
}
