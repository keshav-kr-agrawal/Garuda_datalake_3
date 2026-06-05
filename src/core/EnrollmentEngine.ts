/**
 * EnrollmentEngine — Multi-angle face enrollment state machine.
 *
 * Orchestrates the 6-step guided face scan, collects per-angle embeddings,
 * builds a weighted master FaceModel, and persists it via the provided database.
 *
 * Dependencies are injected via constructor — no hard singletons.
 *
 * @example
 * ```ts
 * import { EnrollmentEngine, LivenessDetector, FaceEmbedder, LocalDatabase } from 'nhai-garuda';
 *
 * const engine = new EnrollmentEngine(
 *   new LivenessDetector(),
 *   new FaceEmbedder(),
 *   database
 * );
 * engine.startEnrollment('user-001', 'John Doe', 'Toll Supervisor');
 * // In frame callback: const result = await engine.processFrame(landmarks);
 * ```
 */

import { LivenessDetector, ENROLLMENT_STEPS } from './LivenessDetector';
import { FaceEmbedder } from './FaceEmbedder';
import type {
  Landmark3D,
  AngleEmbedding,
  EnrollmentFrameResult,
  OrchestratorState,
  EnrollmentSessionInfo,
  OrchestratorStatus,
  EnrolledUser,
} from '../types';

// Re-export types
export type { OrchestratorState, EnrollmentSessionInfo, OrchestratorStatus };

/** Callback to persist a newly enrolled user */
export type EnrollUserFn = (user: EnrolledUser) => Promise<boolean>;

/** Callback to check if a face already exists in the database */
export type VectorSearchFn = (embedding: Float32Array) => Promise<{
  user: EnrolledUser | null;
  similarity: number;
}>;

export class EnrollmentEngine {
  private static _instance: EnrollmentEngine | null = null;

  private readonly liveness: LivenessDetector;
  private readonly embedder: FaceEmbedder;
  private readonly enrollUser?: EnrollUserFn;
  private readonly vectorSearch?: VectorSearchFn;

  private state: OrchestratorState = 'IDLE';
  private session: EnrollmentSessionInfo | null = null;
  private capturedAngles: AngleEmbedding[] = [];
  private lastFrameResult: EnrollmentFrameResult | null = null;
  private errorMessage: string | null = null;
  private capturedStepNames = new Set<string>();

  constructor(
    liveness?: LivenessDetector,
    embedder?: FaceEmbedder,
    options?: {
      enrollUser?: EnrollUserFn;
      vectorSearch?: VectorSearchFn;
    }
  ) {
    this.liveness = liveness ?? LivenessDetector.getInstance();
    this.embedder = embedder ?? FaceEmbedder.getInstance();
    this.enrollUser = options?.enrollUser;
    this.vectorSearch = options?.vectorSearch;
  }

  /** Backward-compatible singleton. */
  public static getInstance(): EnrollmentEngine {
    if (!EnrollmentEngine._instance) {
      EnrollmentEngine._instance = new EnrollmentEngine();
    }
    return EnrollmentEngine._instance;
  }

  public static resetInstance(): void {
    EnrollmentEngine._instance = null;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /** Start a new enrollment session for the given user. */
  public startEnrollment(userId: string, userName: string, userRole: string): void {
    this.session = { userId, userName, userRole };
    this.capturedAngles = [];
    this.capturedStepNames = new Set();
    this.lastFrameResult = null;
    this.errorMessage = null;
    this.state = 'ENROLLING';
    this.liveness.resetEnrollment();
    this.embedder.initialize().catch(() => {});
  }

  /** Cancel any active enrollment. */
  public cancelEnrollment(): void {
    this.state = 'IDLE';
    this.session = null;
    this.capturedAngles = [];
    this.capturedStepNames = new Set();
    this.liveness.resetEnrollment();
  }

  /** Get current orchestrator status. */
  public getStatus(): OrchestratorStatus {
    return {
      state: this.state,
      session: this.session,
      frameResult: this.lastFrameResult,
      capturedAngles: [...this.capturedAngles],
      errorMessage: this.errorMessage,
    };
  }

  /**
   * Feed a MediaPipe FaceMesh frame into the enrollment engine.
   *
   * @param landmarks  Scaled 3D landmarks (x, y, z in pixel space)
   * @param generateGeometryEmbedding  Optional callback for CNN inference
   */
  public async processFrame(
    landmarks: Landmark3D[],
    generateGeometryEmbedding?: (landmarks: Landmark3D[]) => Promise<Float32Array> | Float32Array
  ): Promise<EnrollmentFrameResult | null> {
    if (this.state !== 'ENROLLING') return null;

    const result = this.liveness.processEnrollmentFrame(landmarks);
    this.lastFrameResult = result;

    // Capture angle embedding when step completes
    if (result.isStepComplete && !result.isEnrollmentComplete) {
      const completedStep = result.completedSteps[result.completedSteps.length - 1];
      if (completedStep && !this.capturedStepNames.has(completedStep)) {
        this.capturedStepNames.add(completedStep);
        await this._captureAngleEmbedding(completedStep, landmarks, result.pose, generateGeometryEmbedding);
      }
    }

    // All steps done → transition to SAVING
    if (result.isEnrollmentComplete && this.state === 'ENROLLING') {
      const lastStepName = ENROLLMENT_STEPS[ENROLLMENT_STEPS.length - 1].step;
      if (!this.capturedStepNames.has(lastStepName)) {
        this.capturedStepNames.add(lastStepName);
        await this._captureAngleEmbedding(lastStepName, landmarks, result.pose, generateGeometryEmbedding);
      }
      this.state = 'SAVING';
    }

    return result;
  }

  /**
   * Build the master FaceModel from captured angles and save it.
   * Call when state === 'SAVING'.
   *
   * @returns The built EnrolledUser if successful, null on error.
   */
  public async buildAndSaveFaceModel(snapshotBase64?: string): Promise<EnrolledUser | null> {
    if (!this.session) {
      this.errorMessage = 'No active session. Call startEnrollment() first.';
      this.state = 'ERROR';
      return null;
    }

    if (this.capturedAngles.length === 0) {
      this.errorMessage = 'No angle embeddings captured.';
      this.state = 'ERROR';
      return null;
    }

    try {
      const angleInputs = this.capturedAngles.map(a => ({
        step: a.step,
        embedding: new Float32Array(a.embedding),
      }));
      const masterF32 = this.embedder.buildMasterEmbedding(angleInputs);
      const masterEmbedding = Array.from(masterF32);

      // Check if face already registered (if vectorSearch provided)
      if (this.vectorSearch) {
        const matchResult = await this.vectorSearch(masterF32);
        if (matchResult.user && matchResult.similarity >= 0.72) {
          this.errorMessage = `ALREADY_REGISTERED:${matchResult.user.name}:${matchResult.user.id}`;
          this.state = 'COMPLETE';
          return null;
        }
      }

      const newUser: EnrolledUser = {
        id: this.session.userId,
        name: this.session.userName,
        role: this.session.userRole,
        embedding: masterEmbedding,
        faceModel: {
          masterEmbedding,
          angleEmbeddings: this.capturedAngles,
          enrolledAt: Date.now(),
          version: 1,
        },
      };

      // Persist if enrollUser callback provided
      if (this.enrollUser) {
        const success = await this.enrollUser(newUser);
        if (!success) {
          throw new Error('Database enrollment failed.');
        }
      }

      this.state = 'COMPLETE';
      return newUser;
    } catch (err: any) {
      this.errorMessage = err.message || 'Unknown error saving face model.';
      this.state = 'ERROR';
      return null;
    }
  }

  /** Reset to IDLE. Call after COMPLETE or ERROR. */
  public reset(): void {
    this.state = 'IDLE';
    this.session = null;
    this.capturedAngles = [];
    this.capturedStepNames = new Set();
    this.lastFrameResult = null;
    this.errorMessage = null;
    this.liveness.resetEnrollment();
  }

  /** Get captured angles (for external use). */
  public getCapturedAngles(): AngleEmbedding[] {
    return [...this.capturedAngles];
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private async _captureAngleEmbedding(
    step: string,
    landmarks: Landmark3D[],
    pose: { yaw: number; pitch: number; roll: number },
    generateGeometryEmbedding?: (landmarks: Landmark3D[]) => Promise<Float32Array> | Float32Array
  ): Promise<void> {
    let rawEmbedding: Float32Array;

    if (generateGeometryEmbedding) {
      rawEmbedding = await generateGeometryEmbedding(landmarks);
    } else {
      rawEmbedding = this.embedder.generateGeometrySignature(landmarks);
    }

    const angleEntry: AngleEmbedding = {
      step,
      embedding: Array.from(rawEmbedding),
      poseYaw: pose.yaw,
      posePitch: pose.pitch,
      poseRoll: pose.roll,
      capturedAt: Date.now(),
    };

    this.capturedAngles.push(angleEntry);
  }
}
