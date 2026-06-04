/**
 * enrollmentOrchestrator.ts
 *
 * Phone-style Face ID enrollment state machine.
 * Orchestrates the 6-step guided face scan, collects per-angle embeddings,
 * builds a weighted master FaceModel, and persists it to LocalDatabaseService.
 *
 * Usage:
 *   const orchestrator = EnrollmentOrchestratorService.getInstance();
 *   orchestrator.startEnrollment(userId, userName, userRole);
 *
 *   // In MediaPipe onResults callback:
 *   const result = orchestrator.processFrame(scaledLandmarks);
 *   if (result.isEnrollmentComplete) {
 *     await orchestrator.buildAndSaveFaceModel();
 *   }
 */

import { Landmark3D, LivenessMathService, ENROLLMENT_STEPS, EnrollmentFrameResult } from './livenessMath';
import { FaceEmbedderService, AngleEmbedding } from './faceEmbedder';
import { LocalDatabaseService, EnrolledUser } from './databaseSchema';

// ─── Types exported for UI consumption ────────────────────────────────────────

export type OrchestratorState =
  | 'IDLE'
  | 'ENROLLING'
  | 'SAVING'
  | 'COMPLETE'
  | 'ERROR';

export interface EnrollmentSessionInfo {
  userId: string;
  userName: string;
  userRole: string;
}

export interface OrchestratorStatus {
  state: OrchestratorState;
  session: EnrollmentSessionInfo | null;
  /** Latest frame result from LivenessMathService */
  frameResult: EnrollmentFrameResult | null;
  /** Angle embeddings captured so far (one per completed step) */
  capturedAngles: AngleEmbedding[];
  errorMessage: string | null;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class EnrollmentOrchestratorService {
  private static instance: EnrollmentOrchestratorService;

  private readonly liveness = LivenessMathService.getInstance();
  private readonly embedder = FaceEmbedderService.getInstance();
  private readonly db = LocalDatabaseService.getInstance();

  private state: OrchestratorState = 'IDLE';
  private session: EnrollmentSessionInfo | null = null;
  private capturedAngles: AngleEmbedding[] = [];
  private lastFrameResult: EnrollmentFrameResult | null = null;
  private errorMessage: string | null = null;

  /**
   * Tracks which enrollment steps have already had an embedding captured.
   * Prevents double-capture if the frame result lingers on isStepComplete.
   */
  private capturedStepNames = new Set<string>();

  private constructor() {}

  public static getInstance(): EnrollmentOrchestratorService {
    if (!EnrollmentOrchestratorService.instance) {
      EnrollmentOrchestratorService.instance = new EnrollmentOrchestratorService();
    }
    return EnrollmentOrchestratorService.instance;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Kicks off a new enrollment session for the given user.
   * Resets all internal state and starts the 6-step wizard.
   */
  public startEnrollment(userId: string, userName: string, userRole: string): void {
    console.log(`[EnrollmentOrchestrator] Starting enrollment for: ${userName} (${userId})`);
    this.session = { userId, userName, userRole };
    this.capturedAngles = [];
    this.capturedStepNames = new Set();
    this.lastFrameResult = null;
    this.errorMessage = null;
    this.state = 'ENROLLING';
    this.liveness.resetEnrollment();
    this.embedder.initialize().catch(err => {
      console.warn('[EnrollmentOrchestrator] FaceEmbedder init warning:', err);
    });
  }

  /**
   * Cancels any active enrollment and returns to IDLE.
   */
  public cancelEnrollment(): void {
    console.log('[EnrollmentOrchestrator] Enrollment cancelled.');
    this.state = 'IDLE';
    this.session = null;
    this.capturedAngles = [];
    this.capturedStepNames = new Set();
    this.liveness.resetEnrollment();
  }

  /**
   * Current snapshot of the orchestrator for the UI to render.
   */
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
   * Feed a MediaPipe FaceMesh frame into the orchestrator.
   *
   * - If state is not ENROLLING, this is a no-op.
   * - Calls LivenessMathService.processEnrollmentFrame() to get pose analysis.
   * - When a step completes, generates a face geometry embedding and stores it.
   * - When all 6 steps are complete, transitions state to SAVING automatically.
   *
   * @param landmarks  Scaled 3D landmarks (x, y, z in pixel space)
   * @param currentFrame  Optional: current canvas ImageData for CNN inference
   * @returns The latest EnrollmentFrameResult (same as liveness service output)
   */
  public processFrame(
    landmarks: Landmark3D[],
    generateGeometryEmbedding?: (landmarks: Landmark3D[]) => Float32Array
  ): EnrollmentFrameResult | null {
    if (this.state !== 'ENROLLING') return null;

    const result = this.liveness.processEnrollmentFrame(landmarks);
    this.lastFrameResult = result;

    // When a step just completed, capture the angle embedding
    if (result.isStepComplete && !result.isEnrollmentComplete) {
      const completedStep = result.completedSteps[result.completedSteps.length - 1];
      if (completedStep && !this.capturedStepNames.has(completedStep)) {
        this.capturedStepNames.add(completedStep);
        this._captureAngleEmbedding(completedStep, landmarks, result.pose, generateGeometryEmbedding);
      }
    }

    // When all steps done, capture the final step and transition to SAVING
    if (result.isEnrollmentComplete && this.state === 'ENROLLING') {
      // Capture the last step if not already done
      const lastStepName = ENROLLMENT_STEPS[ENROLLMENT_STEPS.length - 1].step;
      if (!this.capturedStepNames.has(lastStepName)) {
        this.capturedStepNames.add(lastStepName);
        this._captureAngleEmbedding(lastStepName, landmarks, result.pose, generateGeometryEmbedding);
      }
      this.state = 'SAVING';
      console.log('[EnrollmentOrchestrator] All steps complete. Transitioning to SAVING state.');
    }

    return result;
  }

  /**
   * Builds the master FaceModel from all captured angle embeddings and saves
   * it to the local database. Call this when state === 'SAVING'.
   *
   * @param snapshotBase64  Optional JPEG thumbnail of the user's face
   * @returns true if saved successfully
   */
  public async buildAndSaveFaceModel(snapshotBase64?: string): Promise<boolean> {
    if (!this.session) {
      this.errorMessage = 'No active session. Call startEnrollment() first.';
      this.state = 'ERROR';
      return false;
    }

    if (this.capturedAngles.length === 0) {
      this.errorMessage = 'No angle embeddings captured. Cannot build face model.';
      this.state = 'ERROR';
      return false;
    }

    try {
      console.log(`[EnrollmentOrchestrator] Building master embedding from ${this.capturedAngles.length} angles...`);

      // Build weighted master embedding
      const angleInputs = this.capturedAngles.map(a => ({
        step: a.step,
        embedding: new Float32Array(a.embedding),
      }));
      const masterF32 = this.embedder.buildMasterEmbedding(angleInputs);
      const masterEmbedding = Array.from(masterF32);

      const newUser: EnrolledUser = {
        id: this.session.userId,
        name: this.session.userName,
        role: this.session.userRole,
        // Legacy flat embedding = master embedding for backward compat
        embedding: masterEmbedding,
        // Rich face model with per-angle data
        faceModel: {
          masterEmbedding,
          angleEmbeddings: this.capturedAngles,
          enrolledAt: Date.now(),
          version: 1,
        },
      };

      const success = await this.db.enrollUser(newUser);

      if (success) {
        // Optionally store thumbnail
        if (snapshotBase64) {
          localStorage.setItem(`@avatar_${newUser.id}`, snapshotBase64);
        }
        console.log(`[EnrollmentOrchestrator] Successfully enrolled: ${newUser.name} with ${this.capturedAngles.length} angle embeddings.`);
        this.state = 'COMPLETE';
        return true;
      } else {
        throw new Error('Database enrollment failed.');
      }
    } catch (err: any) {
      console.error('[EnrollmentOrchestrator] Error saving face model:', err);
      this.errorMessage = err.message || 'Unknown error saving face model.';
      this.state = 'ERROR';
      return false;
    }
  }

  /**
   * Resets the orchestrator back to IDLE state.
   * Call after COMPLETE or ERROR to allow a fresh start.
   */
  public reset(): void {
    this.state = 'IDLE';
    this.session = null;
    this.capturedAngles = [];
    this.capturedStepNames = new Set();
    this.lastFrameResult = null;
    this.errorMessage = null;
    this.liveness.resetEnrollment();
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  /**
   * Generates a face geometry embedding for the given landmarks and step,
   * then appends it to capturedAngles.
   *
   * If a CNN inference callback is provided (from the UI layer), it is called
   * to get a real MobileFaceNet embedding. Otherwise falls back to the
   * geometric signature approach (same as DesktopWebDashboard).
   */
  private _captureAngleEmbedding(
    step: string,
    landmarks: Landmark3D[],
    pose: { yaw: number; pitch: number; roll: number },
    generateGeometryEmbedding?: (landmarks: Landmark3D[]) => Float32Array
  ): void {
    let rawEmbedding: Float32Array;

    if (generateGeometryEmbedding) {
      rawEmbedding = generateGeometryEmbedding(landmarks);
    } else {
      // Built-in geometric signature fallback (128-D nose-relative distances)
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
    console.log(`[EnrollmentOrchestrator] Captured angle: ${step} (yaw=${pose.yaw.toFixed(1)}, pitch=${pose.pitch.toFixed(1)})`);
  }

}
