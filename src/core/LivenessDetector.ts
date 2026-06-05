/**
 * LivenessDetector — Anti-spoofing liveness detection via facial landmark analysis.
 *
 * Computes Eye Aspect Ratio (EAR), Mouth Aspect Ratio (MAR), and 3D head pose
 * estimation from MediaPipe FaceMesh 468-point landmarks. Implements a
 * challenge-response protocol (blink, smile, turn) to prevent photo/video replay.
 *
 * Also manages guided multi-angle enrollment (iPhone Face ID style).
 *
 * Zero external dependencies — pure TypeScript math.
 *
 * @example
 * ```ts
 * import { LivenessDetector } from 'nhai-garuda';
 *
 * const detector = new LivenessDetector();
 * const challenges = detector.generateChallengeSequence();
 * // Feed frames: detector.processFrame(landmarks, challenges[0])
 * ```
 */

import type {
  Landmark3D,
  LivenessChallenge,
  EnrollmentStep,
  EnrollmentStepConfig,
  EnrollmentFrameResult,
  ChallengeState,
} from '../types';

// Re-export types
export type { Landmark3D, LivenessChallenge, EnrollmentStep, EnrollmentStepConfig, EnrollmentFrameResult, ChallengeState };

/** Predefined 6-step enrollment sequence (mirrors iPhone Face ID / Android enrollment) */
export const ENROLLMENT_STEPS: EnrollmentStepConfig[] = [
  {
    step: 'LOOK_CENTER',
    label: 'Face Forward',
    guidance: 'Look straight ahead at the camera',
    arrow: 'none',
    requiredFrames: 10,
    poseCheck: (yaw, pitch, roll) =>
      Math.abs(yaw) < 22 && Math.abs(pitch) < 22 && Math.abs(roll) < 18,
  },
  {
    step: 'LOOK_UP',
    label: 'Look Up',
    guidance: 'Slowly tilt your head UP',
    arrow: 'up',
    requiredFrames: 10,
    poseCheck: (yaw, pitch) =>
      pitch < -5 && Math.abs(yaw) < 18,
  },
  {
    step: 'LOOK_DOWN',
    label: 'Look Down',
    guidance: 'Slowly tilt your head DOWN',
    arrow: 'down',
    requiredFrames: 10,
    poseCheck: (yaw, pitch) =>
      pitch > 5 && Math.abs(yaw) < 18,
  },
  {
    step: 'TURN_LEFT',
    label: 'Turn Left',
    guidance: 'Slowly turn your head to the LEFT',
    arrow: 'left',
    requiredFrames: 10,
    poseCheck: (yaw) => yaw > 12,
  },
  {
    step: 'TURN_RIGHT',
    label: 'Turn Right',
    guidance: 'Slowly turn your head to the RIGHT',
    arrow: 'right',
    requiredFrames: 10,
    poseCheck: (yaw) => yaw < -12,
  },
  {
    step: 'TILT_LEFT',
    label: 'Tilt Sideways',
    guidance: 'Gently tilt your head to the left shoulder',
    arrow: 'tilt-left',
    requiredFrames: 10,
    poseCheck: (_yaw, _pitch, roll) => roll > 8,
  },
];

export class LivenessDetector {
  private static _instance: LivenessDetector | null = null;

  // Baselines for dynamic calibration
  private baselineEAR = 0.30;
  private baselineMAR = 0.15;
  private calibrationFrames = 0;
  private calibrationLimit = 10;
  private earSum = 0;
  private marSum = 0;

  // Challenge tracking
  private hasBlinked = false;
  private blinkDetectCount = 0;
  private hasSmiled = false;
  private hasTurnedLeft = false;
  private hasTurnedRight = false;
  private challengeStableFrames = 0;
  private activeChallenge: LivenessChallenge | null = null;

  // Grace period (~15 frames at 30fps ≈ 0.5s)
  private challengeGraceFrames = 0;
  private readonly CHALLENGE_GRACE_LIMIT = 15;

  // Enrollment state
  private enrollmentStepIdx = 0;
  private enrollmentCompletedSteps: EnrollmentStep[] = [];
  private enrollmentStableFrameCount = 0;

  constructor() {}

  /** Backward-compatible singleton accessor. */
  public static getInstance(): LivenessDetector {
    if (!LivenessDetector._instance) {
      LivenessDetector._instance = new LivenessDetector();
    }
    return LivenessDetector._instance;
  }

  /** Reset the singleton (useful for testing). */
  public static resetInstance(): void {
    LivenessDetector._instance = null;
  }

  /**
   * Generates a randomized 3-challenge sequence from the pool of 4.
   * Fisher-Yates shuffle ensures unpredictable order for anti-replay.
   */
  public generateChallengeSequence(): LivenessChallenge[] {
    const pool: LivenessChallenge[] = ['BLINK', 'SMILE', 'TURN_LEFT', 'TURN_RIGHT'];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, 3);
  }

  /** Full reset of calibration + challenge + enrollment state. */
  public reset(): void {
    this.calibrationFrames = 0;
    this.earSum = 0;
    this.marSum = 0;
    this.baselineEAR = 0.30;
    this.baselineMAR = 0.15;
    this.hasBlinked = false;
    this.blinkDetectCount = 0;
    this.hasSmiled = false;
    this.hasTurnedLeft = false;
    this.hasTurnedRight = false;
    this.challengeStableFrames = 0;
    this.challengeGraceFrames = 0;
    this.activeChallenge = null;
  }

  /** Reset only per-challenge state; preserve calibrated baselines. */
  public resetChallengeState(): void {
    this.hasBlinked = false;
    this.blinkDetectCount = 0;
    this.hasSmiled = false;
    this.hasTurnedLeft = false;
    this.hasTurnedRight = false;
    this.challengeStableFrames = 0;
    this.challengeGraceFrames = 0;
  }

  /** Reset enrollment wizard to step 0. */
  public resetEnrollment(): void {
    this.enrollmentStepIdx = 0;
    this.enrollmentCompletedSteps = [];
    this.enrollmentStableFrameCount = 0;
  }

  // ─── Enrollment Frame Processing ────────────────────────────────────────────

  /**
   * Process a single camera frame during enrollment.
   * Checks current step's pose threshold and accumulates stable frames.
   */
  public processEnrollmentFrame(landmarks: Landmark3D[]): EnrollmentFrameResult {
    const totalSteps = ENROLLMENT_STEPS.length;
    const stepConfig = ENROLLMENT_STEPS[this.enrollmentStepIdx];
    const pose = this.estimatePose(landmarks);

    const inPosition = stepConfig.poseCheck(pose.yaw, pose.pitch, pose.roll);

    if (inPosition) {
      this.enrollmentStableFrameCount++;
    } else {
      this.enrollmentStableFrameCount = Math.max(0, this.enrollmentStableFrameCount - 2);
    }

    const stepProgress = Math.min(
      this.enrollmentStableFrameCount / stepConfig.requiredFrames,
      1.0
    );
    const isStepComplete = this.enrollmentStableFrameCount >= stepConfig.requiredFrames;

    if (isStepComplete) {
      this.enrollmentCompletedSteps = [
        ...this.enrollmentCompletedSteps,
        stepConfig.step,
      ];
      this.enrollmentStableFrameCount = 0;
      this.enrollmentStepIdx = Math.min(this.enrollmentStepIdx + 1, totalSteps);
    }

    const isEnrollmentComplete = this.enrollmentStepIdx >= totalSteps;
    const overallProgress =
      (this.enrollmentCompletedSteps.length + stepProgress) / totalSteps;

    const currentConfig = isEnrollmentComplete
      ? ENROLLMENT_STEPS[totalSteps - 1]
      : ENROLLMENT_STEPS[this.enrollmentStepIdx];

    const guidanceMessage = isEnrollmentComplete
      ? '✅ Scan complete! Saving your face model...'
      : isStepComplete
      ? `✓ ${stepConfig.label} captured!`
      : stepConfig.guidance;

    return {
      currentStep: currentConfig.step,
      currentStepConfig: currentConfig,
      completedSteps: [...this.enrollmentCompletedSteps],
      stepProgress: isEnrollmentComplete ? 1.0 : stepProgress,
      overallProgress: Math.min(overallProgress, 1.0),
      isStepComplete,
      isEnrollmentComplete,
      guidanceMessage,
      pose,
    };
  }

  /** Get config for current enrollment step (null if complete). */
  public getCurrentEnrollmentStepConfig(): EnrollmentStepConfig | null {
    if (this.enrollmentStepIdx >= ENROLLMENT_STEPS.length) return null;
    return ENROLLMENT_STEPS[this.enrollmentStepIdx];
  }

  // ─── Geometric Calculations ─────────────────────────────────────────────────

  /** Euclidean distance between two 3D landmarks. */
  public distance3D(p1: Landmark3D, p2: Landmark3D): number {
    return Math.sqrt(
      (p1.x - p2.x) ** 2 +
      (p1.y - p2.y) ** 2 +
      (p1.z - p2.z) ** 2
    );
  }

  /** Euclidean distance between two 2D landmarks (projected). */
  public distance2D(p1: Landmark3D, p2: Landmark3D): number {
    return Math.sqrt(
      (p1.x - p2.x) ** 2 +
      (p1.y - p2.y) ** 2
    );
  }

  /**
   * Eye Aspect Ratio (EAR).
   * EAR = (||p2 - p6|| + ||p3 - p5||) / (2 * ||p1 - p4||)
   */
  public calculateEAR(landmarks: Landmark3D[]): number {
    if (landmarks.length < 468) return 0.30;

    const l1 = landmarks[362], l2 = landmarks[385], l3 = landmarks[386];
    const l4 = landmarks[263], l5 = landmarks[374], l6 = landmarks[380];
    const leftEAR = (this.distance3D(l2, l6) + this.distance3D(l3, l5)) / (2.0 * this.distance3D(l1, l4));

    const r1 = landmarks[33],  r2 = landmarks[160], r3 = landmarks[159];
    const r4 = landmarks[133], r5 = landmarks[145], r6 = landmarks[144];
    const rightEAR = (this.distance3D(r2, r6) + this.distance3D(r3, r5)) / (2.0 * this.distance3D(r1, r4));

    return (leftEAR + rightEAR) / 2.0;
  }

  /**
   * Mouth Aspect Ratio (MAR).
   * MAR = (||m2 - m8|| + ||m3 - m7|| + ||m4 - m6||) / (2 * ||m1 - m5||)
   */
  public calculateMAR(landmarks: Landmark3D[]): number {
    if (landmarks.length < 468) return 0.15;

    const m1 = landmarks[78],  m2 = landmarks[81],  m3 = landmarks[82];
    const m4 = landmarks[13],  m5 = landmarks[308], m6 = landmarks[14];
    const m7 = landmarks[312], m8 = landmarks[311];

    const verticalDist = this.distance3D(m2, m8) + this.distance3D(m3, m7) + this.distance3D(m4, m6);
    const horizontalDist = 2.0 * this.distance3D(m1, m5);

    return horizontalDist === 0 ? 0 : verticalDist / horizontalDist;
  }

  /**
   * Lightweight 3D Head Pose Euler Estimation (Yaw, Pitch, Roll).
   * Does not require PnP solvers.
   */
  public estimatePose(landmarks: Landmark3D[]): { yaw: number; pitch: number; roll: number } {
    if (landmarks.length < 468) return { yaw: 0, pitch: 0, roll: 0 };

    const nose = landmarks[1];
    const leftEye = landmarks[263];
    const rightEye = landmarks[33];
    const forehead = landmarks[10];
    const chin = landmarks[152];

    const distRight = this.distance2D(nose, rightEye);
    const distLeft = this.distance2D(nose, leftEye);
    const distEyes = this.distance2D(rightEye, leftEye);
    const yaw = distEyes === 0 ? 0 : ((distRight - distLeft) / distEyes) * 90.0;

    const distForehead = this.distance2D(nose, forehead);
    const distChin = this.distance2D(nose, chin);
    const distFaceHeight = this.distance2D(forehead, chin);
    const pitch = distFaceHeight === 0 ? 0 : ((distForehead - distChin) / distFaceHeight) * 90.0;

    const roll = Math.atan2(leftEye.y - rightEye.y, leftEye.x - rightEye.x) * (180.0 / Math.PI);

    return { yaw, pitch, roll };
  }

  // ─── Calibration ────────────────────────────────────────────────────────────

  /** Calibrates EAR/MAR baselines using the first N open-eye frames. */
  public calibrate(ear: number, mar: number): boolean {
    if (this.calibrationFrames < this.calibrationLimit) {
      this.earSum += ear;
      this.marSum += mar;
      this.calibrationFrames++;

      if (this.calibrationFrames === this.calibrationLimit) {
        this.baselineEAR = this.earSum / this.calibrationLimit;
        this.baselineMAR = this.marSum / this.calibrationLimit;
      }
      return false;
    }
    return true;
  }

  // ─── Challenge-Response Processing ──────────────────────────────────────────

  /** Process a single frame for challenge-response liveness verification. */
  public processFrame(
    landmarks: Landmark3D[],
    activeChallenge: LivenessChallenge
  ): ChallengeState {
    if (this.activeChallenge !== activeChallenge) {
      this.activeChallenge = activeChallenge;
      this.resetChallengeState();
    }

    const ear = this.calculateEAR(landmarks);
    const mar = this.calculateMAR(landmarks);
    const { yaw, pitch, roll } = this.estimatePose(landmarks);
    const metrics = { ear, mar, yaw, pitch, roll };

    const calibrated = this.calibrate(ear, mar);
    if (!calibrated) {
      return {
        currentChallenge: activeChallenge,
        progress: this.calibrationFrames / this.calibrationLimit,
        isCalibrated: false,
        message: 'Calibrating system... Keep eyes open',
        metrics,
      };
    }

    // Grace period
    if (this.challengeGraceFrames < this.CHALLENGE_GRACE_LIMIT) {
      this.challengeGraceFrames++;
      const challengeLabels: Record<string, string> = {
        'BLINK': 'blink your eyes',
        'SMILE': 'smile clearly',
        'TURN_LEFT': 'turn your head left',
        'TURN_RIGHT': 'turn your head right',
      };
      const actionLabel = challengeLabels[activeChallenge] || activeChallenge;
      return {
        currentChallenge: activeChallenge,
        progress: 0,
        isCalibrated: true,
        message: `Get ready to ${actionLabel}...`,
        metrics,
      };
    }

    let progress = 0;
    let message = '';
    let success = false;

    switch (activeChallenge) {
      case 'BLINK': {
        const blinkThreshold = this.baselineEAR * 0.72;
        if (ear < blinkThreshold) {
          this.blinkDetectCount++;
        } else if (this.blinkDetectCount > 0 && ear >= this.baselineEAR * 0.85) {
          this.hasBlinked = true;
        }
        progress = this.hasBlinked ? 1 : (this.blinkDetectCount > 0 ? 0.5 : 0);
        message = this.hasBlinked ? 'Blink detected!' : 'Please blink your eyes';
        success = this.hasBlinked;
        break;
      }

      case 'SMILE': {
        const smileThreshold = this.baselineMAR * 1.28;
        if (mar > smileThreshold) {
          this.hasSmiled = true;
        }
        progress = this.hasSmiled ? 1 : Math.min(mar / smileThreshold, 0.9);
        message = this.hasSmiled ? 'Smile detected!' : 'Please smile clearly';
        success = this.hasSmiled;
        break;
      }

      case 'TURN_LEFT': {
        const leftYawThreshold = 10.0;
        if (yaw > leftYawThreshold) {
          this.hasTurnedLeft = true;
        }
        progress = this.hasTurnedLeft ? 1 : Math.min(Math.max(yaw, 0) / leftYawThreshold, 0.9);
        message = this.hasTurnedLeft ? 'Left turn detected!' : 'Slowly turn your head left';
        success = this.hasTurnedLeft;
        break;
      }

      case 'TURN_RIGHT': {
        const rightYawThreshold = -10.0;
        if (yaw < rightYawThreshold) {
          this.hasTurnedRight = true;
        }
        progress = this.hasTurnedRight ? 1 : Math.min(Math.max(-yaw, 0) / Math.abs(rightYawThreshold), 0.9);
        message = this.hasTurnedRight ? 'Right turn detected!' : 'Slowly turn your head right';
        success = this.hasTurnedRight;
        break;
      }

      case 'SUCCESS':
        return { currentChallenge: 'SUCCESS', progress: 1.0, isCalibrated: true, message: 'Liveness verification successful!', metrics };

      case 'FAILED':
        return { currentChallenge: 'FAILED', progress: 0.0, isCalibrated: true, message: 'Verification failed. Try again.', metrics };
    }

    return {
      currentChallenge: activeChallenge,
      progress: success ? 1.0 : progress,
      isCalibrated: true,
      message,
      metrics,
    };
  }
}
