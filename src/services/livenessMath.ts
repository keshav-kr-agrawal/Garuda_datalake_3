export interface Landmark3D {
  x: number;
  y: number;
  z: number;
}

export type LivenessChallenge = 'BLINK' | 'SMILE' | 'TURN_LEFT' | 'TURN_RIGHT' | 'SUCCESS' | 'FAILED';

// ─── Phone-style Enrollment Steps ────────────────────────────────────────────
// Mirrors iPhone Face ID / Android enrollment: guided multi-angle head scan.
export type EnrollmentStep =
  | 'LOOK_CENTER'   // Face straight ahead — baseline
  | 'LOOK_UP'       // Pitch > +15°
  | 'LOOK_DOWN'     // Pitch < -15°
  | 'TURN_LEFT'     // Yaw > +20°
  | 'TURN_RIGHT'    // Yaw < -20°
  | 'TILT_LEFT';    // Roll > +12°

export interface EnrollmentStepConfig {
  step: EnrollmentStep;
  label: string;
  guidance: string;
  arrow: 'none' | 'up' | 'down' | 'left' | 'right' | 'tilt-left';
  /** How many consecutive stable frames required before auto-capturing */
  requiredFrames: number;
  /** Pose check: returns true when the user is in correct position */
  poseCheck: (yaw: number, pitch: number, roll: number) => boolean;
}

export const ENROLLMENT_STEPS: EnrollmentStepConfig[] = [
  {
    step: 'LOOK_CENTER',
    label: 'Face Forward',
    guidance: 'Look straight ahead at the camera',
    arrow: 'none',
    requiredFrames: 20,
    poseCheck: (yaw, pitch, roll) =>
      Math.abs(yaw) < 10 && Math.abs(pitch) < 10 && Math.abs(roll) < 8,
  },
  {
    step: 'LOOK_UP',
    label: 'Look Up',
    guidance: 'Slowly tilt your head UP',
    arrow: 'up',
    requiredFrames: 20,
    poseCheck: (yaw, pitch, _roll) =>
      pitch > 14 && Math.abs(yaw) < 15,
  },
  {
    step: 'LOOK_DOWN',
    label: 'Look Down',
    guidance: 'Slowly tilt your head DOWN',
    arrow: 'down',
    requiredFrames: 20,
    poseCheck: (yaw, pitch, _roll) =>
      pitch < -14 && Math.abs(yaw) < 15,
  },
  {
    step: 'TURN_LEFT',
    label: 'Turn Left',
    guidance: 'Slowly turn your head to the LEFT',
    arrow: 'left',
    requiredFrames: 20,
    poseCheck: (yaw, _pitch, _roll) => yaw > 18,
  },
  {
    step: 'TURN_RIGHT',
    label: 'Turn Right',
    guidance: 'Slowly turn your head to the RIGHT',
    arrow: 'right',
    requiredFrames: 20,
    poseCheck: (yaw, _pitch, _roll) => yaw < -18,
  },
  {
    step: 'TILT_LEFT',
    label: 'Tilt Sideways',
    guidance: 'Gently tilt your head to the left shoulder',
    arrow: 'tilt-left',
    requiredFrames: 18,
    poseCheck: (_yaw, _pitch, roll) => roll > 11,
  },
];

export interface EnrollmentFrameResult {
  currentStep: EnrollmentStep;
  currentStepConfig: EnrollmentStepConfig;
  completedSteps: EnrollmentStep[];
  /** 0–1 progress for the current step (based on stable frame count) */
  stepProgress: number;
  /** 0–1 progress across all steps */
  overallProgress: number;
  isStepComplete: boolean;
  isEnrollmentComplete: boolean;
  guidanceMessage: string;
  /** Estimated pose values for display */
  pose: { yaw: number; pitch: number; roll: number };
}

export interface ChallengeState {
  currentChallenge: LivenessChallenge;
  progress: number; // 0 to 1
  isCalibrated: boolean;
  message: string;
}

export class LivenessMathService {
  private static instance: LivenessMathService;
  
  // Baselines for dynamic calibration
  private baselineEAR = 0.30;
  private baselineMAR = 0.15;
  private calibrationFrames = 0;
  private calibrationLimit = 15; // first 15 frames are used to calibrate
  private earSum = 0;
  private marSum = 0;

  // Challenge tracking states
  private hasBlinked = false;
  private blinkDetectCount = 0;
  private hasSmiled = false;
  private hasTurned = false;

  // ─── Enrollment state ──────────────────────────────────────────────────────
  private enrollmentStepIdx = 0;
  private enrollmentCompletedSteps: EnrollmentStep[] = [];
  private enrollmentStableFrameCount = 0;

  private constructor() {}

  public static getInstance(): LivenessMathService {
    if (!LivenessMathService.instance) {
      LivenessMathService.instance = new LivenessMathService();
    }
    return LivenessMathService.instance;
  }

  /**
   * Generates a randomized challenge sequence to prevent sophisticated replay attacks.
   *
   * Pool of 4 possible challenges: BLINK, SMILE, TURN_LEFT, TURN_RIGHT.
   * Each verification session randomly draws 3 from the pool using a
   * Fisher-Yates shuffle, so the order AND the exact set of challenges
   * is unpredictable — making photo/video replay attacks infeasible.
   *
   * Possible sessions (examples):
   *   [TURN_LEFT, BLINK, SMILE]
   *   [SMILE, TURN_RIGHT, BLINK]
   *   [TURN_RIGHT, SMILE, TURN_LEFT]
   *   [BLINK, TURN_LEFT, TURN_RIGHT]  ... etc.
   */
  public generateChallengeSequence(): LivenessChallenge[] {
    // Full pool — all valid liveness challenges
    const pool: LivenessChallenge[] = ['BLINK', 'SMILE', 'TURN_LEFT', 'TURN_RIGHT'];

    // Fisher-Yates shuffle the entire pool
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = pool[i];
      pool[i] = pool[j];
      pool[j] = temp;
    }

    // Pick the first 3 from the shuffled pool
    // → random subset of 3 from 4, in random order
    return pool.slice(0, 3);
  }


  /**
   * Resets calibration and liveness challenge states
   */
  public reset(): void {
    this.calibrationFrames = 0;
    this.earSum = 0;
    this.marSum = 0;
    this.baselineEAR = 0.30;
    this.baselineMAR = 0.15;
    this.hasBlinked = false;
    this.blinkDetectCount = 0;
    this.hasSmiled = false;
    this.hasTurned = false;
  }

  /**
   * Resets the enrollment wizard back to step 0.
   * Call this when starting a fresh enrollment session.
   */
  public resetEnrollment(): void {
    this.enrollmentStepIdx = 0;
    this.enrollmentCompletedSteps = [];
    this.enrollmentStableFrameCount = 0;
  }

  /**
   * Process a single camera frame during enrollment.
   * Checks current step's pose threshold and accumulates stable frames.
   * When requiredFrames is reached, auto-advances to the next step.
   *
   * @param landmarks  468 3D landmark points from MediaPipe FaceMesh
   * @returns EnrollmentFrameResult — drives the wizard UI
   */
  public processEnrollmentFrame(landmarks: Landmark3D[]): EnrollmentFrameResult {
    const totalSteps = ENROLLMENT_STEPS.length;
    const stepConfig = ENROLLMENT_STEPS[this.enrollmentStepIdx];
    const pose = this.estimatePose(landmarks);

    const inPosition = stepConfig.poseCheck(pose.yaw, pose.pitch, pose.roll);

    if (inPosition) {
      this.enrollmentStableFrameCount++;
    } else {
      // Reset stable count if user moves out of position
      this.enrollmentStableFrameCount = Math.max(0, this.enrollmentStableFrameCount - 2);
    }

    const stepProgress = Math.min(
      this.enrollmentStableFrameCount / stepConfig.requiredFrames,
      1.0
    );
    const isStepComplete = this.enrollmentStableFrameCount >= stepConfig.requiredFrames;

    if (isStepComplete) {
      // Auto-advance to next step
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

  /**
   * Returns the step config for the current enrollment step.
   * Useful for rendering directional arrows in the UI.
   */
  public getCurrentEnrollmentStepConfig(): EnrollmentStepConfig | null {
    if (this.enrollmentStepIdx >= ENROLLMENT_STEPS.length) return null;
    return ENROLLMENT_STEPS[this.enrollmentStepIdx];
  }

  /**
   * Calculate Euclidean Distance between two 3D landmarks
   */
  public distance3D(p1: Landmark3D, p2: Landmark3D): number {
    return Math.sqrt(
      (p1.x - p2.x) ** 2 +
      (p1.y - p2.y) ** 2 +
      (p1.z - p2.z) ** 2
    );
  }

  /**
   * Eye Aspect Ratio (EAR)
   * Formula: EAR = (||p2 - p6|| + ||p3 - p5||) / (2 * ||p1 - p4||)
   */
  public calculateEAR(landmarks: Landmark3D[]): number {
    if (landmarks.length < 468) return 0.30;

    // Indices for Left Eye (MediaPipe standard mapping)
    const l1 = landmarks[362]; // Inner corner
    const l2 = landmarks[385]; // Top-left
    const l3 = landmarks[386]; // Top-right
    const l4 = landmarks[263]; // Outer corner
    const l5 = landmarks[374]; // Bottom-right
    const l6 = landmarks[380]; // Bottom-left

    const leftEAR = (this.distance3D(l2, l6) + this.distance3D(l3, l5)) / (2.0 * this.distance3D(l1, l4));

    // Indices for Right Eye (MediaPipe standard mapping)
    const r1 = landmarks[33];   // Inner corner
    const r2 = landmarks[160];  // Top-left
    const r3 = landmarks[159];  // Top-right
    const r4 = landmarks[133];  // Outer corner
    const r5 = landmarks[145];  // Bottom-right
    const r6 = landmarks[144];  // Bottom-left

    const rightEAR = (this.distance3D(r2, r6) + this.distance3D(r3, r5)) / (2.0 * this.distance3D(r1, r4));

    // Return the average EAR of both eyes
    return (leftEAR + rightEAR) / 2.0;
  }

  /**
   * Mouth Aspect Ratio (MAR)
   * Formula: MAR = (||m2 - m8|| + ||m3 - m7|| + ||m4 - m6||) / (2 * ||m1 - m5||)
   */
  public calculateMAR(landmarks: Landmark3D[]): number {
    if (landmarks.length < 468) return 0.15;

    // Indices for Outer/Inner Lip Contour (MediaPipe standard mapping)
    const m1 = landmarks[78];   // Left corner
    const m2 = landmarks[81];   // Top lip left-mid
    const m3 = landmarks[82];   // Top lip center-mid
    const m4 = landmarks[13];   // Top lip right-mid
    const m5 = landmarks[308];  // Right corner
    const m6 = landmarks[14];   // Bottom lip right-mid
    const m7 = landmarks[312];  // Bottom lip center-mid
    const m8 = landmarks[311];  // Bottom lip left-mid

    const verticalDist = this.distance3D(m2, m8) + this.distance3D(m3, m7) + this.distance3D(m4, m6);
    const horizontalDist = 2.0 * this.distance3D(m1, m5);

    return horizontalDist === 0 ? 0 : verticalDist / horizontalDist;
  }

  /**
   * Lightweight 3D Head Pose Euler Estimation (Yaw, Pitch, Roll)
   * Does not require heavy C++ PNP Solvers; ideal for Hermes engine.
   */
  public estimatePose(landmarks: Landmark3D[]): { yaw: number; pitch: number; roll: number } {
    if (landmarks.length < 468) return { yaw: 0, pitch: 0, roll: 0 };

    const nose = landmarks[1];
    const leftEye = landmarks[263];
    const rightEye = landmarks[33];
    const forehead = landmarks[10];
    const chin = landmarks[152];

    // 1. Yaw (Left / Right turn): Compare eye-to-nose relative lateral distance
    const distRight = this.distance3D(nose, rightEye);
    const distLeft = this.distance3D(nose, leftEye);
    const distEyes = this.distance3D(rightEye, leftEye);
    const yaw = distEyes === 0 ? 0 : ((distRight - distLeft) / distEyes) * 90.0; // scale to rough degrees

    // 2. Pitch (Up / Down tilt): Compare forehead-to-nose vs chin-to-nose vertical distance
    const distForehead = this.distance3D(nose, forehead);
    const distChin = this.distance3D(nose, chin);
    const distFaceHeight = this.distance3D(forehead, chin);
    const pitch = distFaceHeight === 0 ? 0 : ((distForehead - distChin) / distFaceHeight) * 90.0;

    // 3. Roll (Head tilt): Angle between outer eye corners
    const roll = Math.atan2(leftEye.y - rightEye.y, leftEye.x - rightEye.x) * (180.0 / Math.PI);

    return { yaw, pitch, roll };
  }

  /**
   * Calibrates baselines using the first N open-eye scanning frames
   */
  public calibrate(ear: number, mar: number): boolean {
    if (this.calibrationFrames < this.calibrationLimit) {
      this.earSum += ear;
      this.marSum += mar;
      this.calibrationFrames++;
      
      if (this.calibrationFrames === this.calibrationLimit) {
        this.baselineEAR = this.earSum / this.calibrationLimit;
        this.baselineMAR = this.marSum / this.calibrationLimit;
        console.log(`[LivenessMath] Calibrated! Baseline EAR: ${this.baselineEAR.toFixed(3)}, Baseline MAR: ${this.baselineMAR.toFixed(3)}`);
      }
      return false;
    }
    return true;
  }

  /**
   * Runs the challenge-response anti-spoofing logic
   */
  public processFrame(
    landmarks: Landmark3D[], 
    activeChallenge: LivenessChallenge
  ): ChallengeState {
    const ear = this.calculateEAR(landmarks);
    const mar = this.calculateMAR(landmarks);
    const { yaw, pitch, roll } = this.estimatePose(landmarks);

    const calibrated = this.calibrate(ear, mar);
    if (!calibrated) {
      return {
        currentChallenge: activeChallenge,
        progress: this.calibrationFrames / this.calibrationLimit,
        isCalibrated: false,
        message: 'Calibrating system... Keep eyes open',
      };
    }

    let progress = 0;
    let message = '';
    let success = false;

    switch (activeChallenge) {
      case 'BLINK':
        // A blink is classified if the EAR falls below 60% of the open-eye baseline
        const blinkThreshold = this.baselineEAR * 0.60;
        
        if (ear < blinkThreshold) {
          this.blinkDetectCount++;
        } else if (this.blinkDetectCount > 0 && ear >= this.baselineEAR * 0.85) {
          // Eye closed then fully opened back up
          this.hasBlinked = true;
        }
        
        progress = this.hasBlinked ? 1 : (this.blinkDetectCount > 0 ? 0.5 : 0);
        message = this.hasBlinked ? 'Blink detected!' : 'Please blink your eyes';
        success = this.hasBlinked;
        break;

      case 'SMILE':
        // A smile is verified if the MAR increases by at least 50% above the open baseline
        const smileThreshold = this.baselineMAR * 1.50;
        if (mar > smileThreshold) {
          this.hasSmiled = true;
        }

        progress = this.hasSmiled ? 1 : Math.min(mar / smileThreshold, 0.9);
        message = this.hasSmiled ? 'Smile detected!' : 'Please smile clearly';
        success = this.hasSmiled;
        break;

      case 'TURN_LEFT':
        // Yaw threshold for left turn (> 15 degrees)
        const leftYawThreshold = 15.0;
        if (yaw > leftYawThreshold) {
          this.hasTurned = true;
        }

        progress = this.hasTurned ? 1 : Math.min(Math.max(yaw, 0) / leftYawThreshold, 0.9);
        message = this.hasTurned ? 'Left turn detected!' : 'Slowly turn your head left';
        success = this.hasTurned;
        break;

      case 'TURN_RIGHT':
        // Yaw threshold for right turn (< -15 degrees)
        const rightYawThreshold = -15.0;
        if (yaw < rightYawThreshold) {
          this.hasTurned = true;
        }

        progress = this.hasTurned ? 1 : Math.min(Math.max(-yaw, 0) / Math.abs(rightYawThreshold), 0.9);
        message = this.hasTurned ? 'Right turn detected!' : 'Slowly turn your head right';
        success = this.hasTurned;
        break;

      case 'SUCCESS':
        return {
          currentChallenge: 'SUCCESS',
          progress: 1.0,
          isCalibrated: true,
          message: 'Liveness verification successful!',
        };

      case 'FAILED':
        return {
          currentChallenge: 'FAILED',
          progress: 0.0,
          isCalibrated: true,
          message: 'Verification failed. Try again.',
        };
    }

    if (success) {
      // Small debounce delay before transitioning
      return {
        currentChallenge: activeChallenge,
        progress: 1.0,
        isCalibrated: true,
        message,
      };
    }

    return {
      currentChallenge: activeChallenge,
      progress,
      isCalibrated: true,
      message,
    };
  }
}
