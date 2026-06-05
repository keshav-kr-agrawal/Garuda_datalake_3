/**
 * nhai-garuda — Public Type Definitions
 *
 * All public interfaces and types exported by the SDK.
 * Consumers import from: import { FaceModel, Landmark3D, ... } from 'nhai-garuda';
 */

// ─── Face Embedding Types ─────────────────────────────────────────────────────

/** Result from a MediaPipe FaceMesh detection pass */
export interface FaceMeshResult {
  landmarks: number[][]; // 468 points, each [x, y, z]
}

/** Runtime mode of the face embedding model */
export type ModelRuntimeMode = 'native-tflite' | 'web-tflite' | 'geometric-fallback' | 'unloaded';

/** Status snapshot of the FaceEmbedder */
export interface FaceEmbedderStatus {
  loaded: boolean;
  mobileFaceNetLoaded: boolean;
  mode: ModelRuntimeMode;
  warnings: string[];
}

/** Configuration for FaceEmbedder initialization */
export interface FaceEmbedderConfig {
  /** Similarity threshold for face verification (default: 0.72) */
  similarityThreshold?: number;
  /**
   * Platform environment hint.
   * - 'web': loads model via window.tflite / tf.js
   * - 'native': loads model via react-native-fast-tflite
   * - 'auto': auto-detect (default)
   */
  platform?: 'web' | 'native' | 'auto';
  /**
   * Optional: provide the TFLite model loader for native platforms.
   * Signature matches `loadTensorflowModel` from react-native-fast-tflite.
   */
  nativeModelLoader?: (path: string, options?: any) => Promise<any>;
  /**
   * Optional: provide the web TFLite runtime object (window.tflite).
   * If not provided, will try to access window.tflite at init time on web.
   */
  webTfliteRuntime?: any;
  /**
   * Optional: provide the tf.js runtime object (window.tf).
   * If not provided, will try to access window.tf at init time on web.
   */
  webTfRuntime?: any;
}

/** A single embedding captured at a specific head angle during enrollment */
export interface AngleEmbedding {
  step: string;           // e.g. 'LOOK_CENTER', 'TURN_LEFT'
  embedding: number[];    // L2-normalized 128-D vector (stored as plain array)
  poseYaw: number;
  posePitch: number;
  poseRoll: number;
  capturedAt: number;     // epoch ms
}

/** Complete multi-angle face model for a single person */
export interface FaceModel {
  userId: string;
  angleEmbeddings: AngleEmbedding[];
  /**
   * Weighted composite of all angle embeddings.
   * Center view gets 2× weight; all others 1×.
   */
  masterEmbedding: number[];
  enrolledAt: number;
  version: number;
}

/** Result from 1:N face detection against enrolled models */
export interface FaceDetectionResult {
  match: boolean;
  userId: string | null;
  confidence: number;
  matchedAngle: string;
}

/** Result from 1:1 face verification */
export interface FaceVerificationResult {
  match: boolean;
  confidence: number;
}

// ─── Liveness Detection Types ─────────────────────────────────────────────────

/** 3D landmark point (MediaPipe FaceMesh coordinate) */
export interface Landmark3D {
  x: number;
  y: number;
  z: number;
}

/** Types of liveness challenges */
export type LivenessChallenge = 'BLINK' | 'SMILE' | 'TURN_LEFT' | 'TURN_RIGHT' | 'ALIGN_PORTRAIT' | 'SUCCESS' | 'FAILED';

/** Phone-style enrollment step identifiers */
export type EnrollmentStep =
  | 'LOOK_CENTER'
  | 'LOOK_UP'
  | 'LOOK_DOWN'
  | 'TURN_LEFT'
  | 'TURN_RIGHT'
  | 'TILT_LEFT';

/** Configuration for a single enrollment step */
export interface EnrollmentStepConfig {
  step: EnrollmentStep;
  label: string;
  guidance: string;
  arrow: 'none' | 'up' | 'down' | 'left' | 'right' | 'tilt-left';
  requiredFrames: number;
  poseCheck: (yaw: number, pitch: number, roll: number) => boolean;
}

/** Result from processing a single enrollment frame */
export interface EnrollmentFrameResult {
  currentStep: EnrollmentStep;
  currentStepConfig: EnrollmentStepConfig;
  completedSteps: EnrollmentStep[];
  stepProgress: number;
  overallProgress: number;
  isStepComplete: boolean;
  isEnrollmentComplete: boolean;
  guidanceMessage: string;
  pose: { yaw: number; pitch: number; roll: number };
}

/** State of a liveness challenge in progress */
export interface ChallengeState {
  currentChallenge: LivenessChallenge;
  progress: number;
  isCalibrated: boolean;
  message: string;
  metrics?: {
    ear: number;
    mar: number;
    yaw: number;
    pitch: number;
    roll: number;
  };
}

// ─── Enrollment Orchestrator Types ────────────────────────────────────────────

/** State machine states for enrollment */
export type OrchestratorState =
  | 'IDLE'
  | 'ENROLLING'
  | 'SAVING'
  | 'COMPLETE'
  | 'ERROR';

/** Info about the current enrollment session */
export interface EnrollmentSessionInfo {
  userId: string;
  userName: string;
  userRole: string;
}

/** Full status snapshot of the enrollment orchestrator */
export interface OrchestratorStatus {
  state: OrchestratorState;
  session: EnrollmentSessionInfo | null;
  frameResult: EnrollmentFrameResult | null;
  capturedAngles: AngleEmbedding[];
  errorMessage: string | null;
}

// ─── Database / Storage Types ─────────────────────────────────────────────────

/** Enrolled user profile stored in local database */
export interface EnrolledUser {
  id: string;
  name: string;
  role: string;
  /** Legacy flat 128-D vector — kept for backward compatibility */
  embedding: number[];
  /** Rich multi-angle face model built by the enrollment wizard */
  faceModel?: {
    masterEmbedding: number[];
    angleEmbeddings: AngleEmbedding[];
    enrolledAt: number;
    version: number;
  };
  syncStatus?: 'PENDING' | 'SYNCED';
}

/** Audit log entry in the cryptographic ledger */
export interface AuditLog {
  id: string;
  timestamp: number;
  userId: string;
  latitude: number;
  longitude: number;
  confidence: number;
  status: 'VERIFIED' | 'SPOOF_DETECTED' | 'FAILED';
  prevHash: string;
  hash: string;
}

/** Storage adapter interface — implement this for custom storage backends */
export interface IStorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  multiRemove?(keys: string[]): Promise<void>;
  clear?(): Promise<void>;
}

/** SQLite query log entry (for debugging/display) */
export interface SqlLogEntry {
  statement: string;
  timestamp: string;
  latencyMs: number;
  rowsAffected: number;
}

// ─── Sync / API Types ─────────────────────────────────────────────────────────

/** AWS configuration for AwsAuthClient */
export interface AwsConfig {
  region: string;
  cognitoUserPoolId: string;
  cognitoClientId: string;
  apiGatewayBaseUrl: string;
  dynamoTableAudit?: string;
  dynamoTableUsers?: string;
  deviceSecretSalt?: string;
}

/** Cognito token bundle */
export interface CognitoTokenBundle {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  username: string;
  deviceId: string;
}

/** Authentication result */
export interface AuthResult {
  success: boolean;
  username?: string;
  role?: string;
  token?: string;
  errorCode?: 'NETWORK_OFFLINE' | 'INVALID_CREDENTIALS' | 'TOKEN_EXPIRED' | 'MFA_REQUIRED' | 'UNKNOWN';
  message?: string;
  isOfflineSession?: boolean;
}

/** NIC Datalake API configuration */
export interface DatalakeApiConfig {
  baseUrl: string;
  timeoutMs?: number;
  appVersion?: string;
  appPackage?: string;
  /** Function to check network connectivity. Return true if online. */
  networkChecker?: () => Promise<boolean>;
}

/** Datalake authentication response */
export interface DatalakeAuthResponse {
  success: boolean;
  token: string;
  expiresAt: number;
  employeeProfile: {
    employeeId: string;
    name: string;
    role: string;
    projectCode: string;
    region: string;
    aadhaarLinked: boolean;
    faceEnrolled: boolean;
  };
}

/** Request to mark attendance */
export interface AttendanceMarkRequest {
  employeeId: string;
  timestamp: number;
  gpsLatitude: number;
  gpsLongitude: number;
  gpsAccuracyMeters: number;
  faceImageBase64?: string;
  livenessScore?: number;
  matchConfidence?: number;
  isOfflineRecord: boolean;
  offlineProofHash?: string;
  offlinePrevHash?: string;
  deviceId: string;
  appVersion: string;
}

/** Response from marking attendance */
export interface AttendanceMarkResponse {
  success: boolean;
  attendanceId: string;
  serverTimestamp: number;
  status: 'VERIFIED' | 'SPOOF_DETECTED' | 'FACE_NOT_FOUND' | 'OUTSIDE_GEOFENCE' | 'FAILED';
  message: string;
}

/** Offline queue entry (extends AttendanceMarkRequest with local tracking) */
export interface OfflineQueueEntry extends AttendanceMarkRequest {
  localId: string;
  enqueuedAt: number;
  retryCount: number;
  syncStatus: 'PENDING' | 'SYNCED' | 'REJECTED';
}

/** AWS sync result */
export interface SyncResult {
  success: boolean;
  syncedCount: number;
  purgedCount: number;
  downloadedUsers: number;
  message: string;
  errorCode?: string;
}
