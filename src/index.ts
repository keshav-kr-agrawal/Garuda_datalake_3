// Core biometric engine
export { FaceEmbedder } from './core/FaceEmbedder';
export { LivenessDetector } from './core/LivenessDetector';
export { EnrollmentEngine } from './core/EnrollmentEngine';
export { CLAHEProcessor } from './core/CLAHEProcessor';

// Cryptographic audit
export { AuditLedger } from './crypto/AuditLedger';

// Storage layer
export { LocalDatabase } from './storage/LocalDatabase';
export { SqliteWebAdapter } from './storage/SqliteWebAdapter';
export { AsyncStorageAdapter } from './storage/AsyncStorageAdapter';

// Sync / API clients
export { DatalakeApiClient } from './sync/DatalakeApiClient';
export { AwsAuthClient } from './sync/AwsAuthClient';
export { AwsSyncClient } from './sync/AwsSyncClient';

// All public types
export * from './types';
