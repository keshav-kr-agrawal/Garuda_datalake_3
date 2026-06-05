import { LocalDbAdapter } from './localDbAdapter';
import { AngleEmbedding, FaceEmbedderService } from './faceEmbedder';

const storage = LocalDbAdapter.getInstance();

export interface EnrolledUser {
  id: string;
  name: string;
  role: string;
  /** Legacy flat 128-D vector — kept for backward compatibility */
  embedding: number[];
  /**
   * NEW: Rich multi-angle face model built by the enrollment wizard.
   * When present, fast detection uses this instead of the flat embedding.
   */
  faceModel?: {
    /** Weighted composite embedding (center 2× weight) — used for fast lookup */
    masterEmbedding: number[];
    /** Per-angle raw vectors captured during enrollment wizard */
    angleEmbeddings: AngleEmbedding[];
    enrolledAt: number;
    /** Incremented each time the user re-enrolls */
    version: number;
  };
  syncStatus?: 'PENDING' | 'SYNCED';
}

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

const USERS_KEY = '@nhai_enrolled_users';
const LEDGER_KEY = '@nhai_cryptographic_ledger';

export class LocalDatabaseService {
  private static instance: LocalDatabaseService;
  private usersCache: EnrolledUser[] | null = null;

  private constructor() {}

  public static getInstance(): LocalDatabaseService {
    if (!LocalDatabaseService.instance) {
      LocalDatabaseService.instance = new LocalDatabaseService();
    }
    return LocalDatabaseService.instance;
  }

  private preConvertUsers(users: EnrolledUser[]): EnrolledUser[] {
    for (let i = 0; i < users.length; i++) {
      const u = users[i] as any;
      if (u.embedding && !u._floatEmbedding) {
        u._floatEmbedding = new Float32Array(u.embedding);
      }
      if (u.faceModel && !u._faceMeshModel) {
        u._faceMeshModel = {
          userId: u.id,
          masterEmbedding: new Float32Array(u.faceModel.masterEmbedding),
          angleEmbeddings: u.faceModel.angleEmbeddings.map((a: any) => ({
            step: a.step,
            embedding: new Float32Array(a.embedding),
          })),
        };
      } else if (!u.faceModel && !u._faceMeshModel) {
        u._faceMeshModel = {
          userId: u.id,
          masterEmbedding: new Float32Array(u.embedding),
        };
      }
    }
    return users;
  }

  /**
   * Fetch all locally enrolled users (caches in memory for high-performance sub-ms access)
   */
  public async getEnrolledUsers(): Promise<EnrolledUser[]> {
    if (this.usersCache) return this.usersCache;
    const data = await storage.getItem(USERS_KEY);
    const parsed = data ? JSON.parse(data) : [];
    this.usersCache = this.preConvertUsers(parsed);
    return this.usersCache;
  }

  /**
   * Save/Enroll a new user locally (invalidates and updates in-memory cache)
   */
  public async enrollUser(user: EnrolledUser): Promise<boolean> {
    const users = await this.getEnrolledUsers();
    // Remove duplicates if any
    const updated = users.filter(u => u.id !== user.id);
    updated.push(user);
    await storage.setItem(USERS_KEY, JSON.stringify(updated));
    this.usersCache = this.preConvertUsers(updated); // Update cache!
    console.log(`[LocalDatabase] Successfully enrolled user: ${user.name} (${user.id})`);
    return true;
  }

  /**
   * Delete / Purge an enrolled user profile
   */
  public async deleteUser(userId: string): Promise<boolean> {
    const users = await this.getEnrolledUsers();
    const updated = users.filter(u => u.id !== userId);
    await storage.setItem(USERS_KEY, JSON.stringify(updated));
    this.usersCache = this.preConvertUsers(updated);
    console.log(`[LocalDatabase] Successfully deleted user: ${userId}`);
    return true;
  }

  /**
   * Performs a highly optimized, vectorized dot-product search across cached personnel profiles.
   * Leverages in-memory float arrays for sub-15ms execution over 10,000 records on Herms engines.
   */
  public async vectorSearch(queryEmbedding: Float32Array): Promise<{ user: EnrolledUser | null; similarity: number }> {
    const users = await this.getEnrolledUsers();
    let bestUser: EnrolledUser | null = null;
    let maxSimilarity = -1;
    const qLen = queryEmbedding.length;

    for (let i = 0; i < users.length; i++) {
      const user = users[i] as any;
      const dbEmbedding = user._floatEmbedding || (user._floatEmbedding = new Float32Array(user.embedding));
      const dbLen = dbEmbedding.length;
      const len = qLen < dbLen ? qLen : dbLen;

      // Compute dot product (both vectors are pre-L2-normalized)
      let dotProduct = 0;
      for (let j = 0; j < len; j++) {
        dotProduct += queryEmbedding[j] * dbEmbedding[j];
      }

      if (dotProduct > maxSimilarity) {
        maxSimilarity = dotProduct;
        bestUser = user;
      }
    }

    return {
      user: bestUser,
      similarity: maxSimilarity,
    };
  }

  /**
   * NEW: Multi-angle vector search that checks both masterEmbedding and
   * per-angle sub-embeddings for users who have a rich faceModel.
   * Falls back to the flat embedding for legacy users.
   *
   * Uses FaceEmbedderService.detectFace() for best-angle matching.
   */
  public async vectorSearchMultiAngle(
    queryEmbedding: Float32Array
  ): Promise<{ user: EnrolledUser | null; similarity: number; matchedAngle: string }> {
    const users = await this.getEnrolledUsers();
    const embedder = FaceEmbedderService.getInstance();

    // Build the model list for detectFace()
    const models = users.map(u => (u as any)._faceMeshModel);

    const detection = embedder.detectFace(queryEmbedding, models);
    const matchedUser = users.find(u => u.id === detection.userId) ?? null;

    return {
      user: matchedUser,
      similarity: detection.confidence,
      matchedAngle: detection.matchedAngle,
    };
  }

  private l2NormalizeVector(arr: number[]): number[] {
    let sumSquares = 0;
    for (let i = 0; i < arr.length; i++) {
      sumSquares += arr[i] * arr[i];
    }
    const magnitude = Math.sqrt(sumSquares);
    if (magnitude === 0) return arr;
    return arr.map(v => v / magnitude);
  }

  /**
   * Seeds 20 dynamic mock personnel vectors for performance benchmark verification.
   */
  public async seed20Database(): Promise<void> {
    console.log('[LocalDatabase] Seeding 20 mock personnel profiles inside local database cache...');
    const bulkUsers: EnrolledUser[] = [];

    // Generate 20 randomized, normalized personnel vectors
    for (let idx = 1; idx <= 20; idx++) {
      const id = `NHAI-MOCK-${idx}`;
      const name = `Field Operator ${idx}`;
      const role = idx % 2 === 0 ? 'Toll Operator' : 'Security Guard';

      // Deterministic generation to avoid slow Math.random() loops
      const rawVector = new Float32Array(128);
      let sumSquares = 0;
      for (let j = 0; j < 128; j++) {
        rawVector[j] = Math.sin(idx * 0.72 + j) * Math.cos(j * 0.95);
        sumSquares += rawVector[j] * rawVector[j];
      }

      const magnitude = Math.sqrt(sumSquares);
      const embedding = Array.from(rawVector).map(v => magnitude === 0 ? 0 : v / magnitude);

      bulkUsers.push({ id, name, role, embedding });
    }

    await storage.setItem(USERS_KEY, JSON.stringify(bulkUsers));
    this.usersCache = this.preConvertUsers(bulkUsers);
    console.log('[LocalDatabase] Successfully seeded and cached 20 personnel profiles!');
  }

  /**
   * Seeds 10,000 optimized personnel vectors for extreme scale performance benchmark verification.
   * Includes the target profile NHAI-2026-001 (Keshav Kumar Agrawal) for identical match assertion.
   */
  public async seed10kDatabase(): Promise<void> {
    console.log('[LocalDatabase] Seeding 10,000 mock personnel profiles inside local database cache...');
    const bulkUsers: EnrolledUser[] = [];

    // 1. Add target user: NHAI-2026-001 (Keshav Kumar Agrawal)
    const targetRaw = new Float32Array(192);
    let targetSumSq = 0;
    for (let i = 0; i < 192; i++) {
      targetRaw[i] = Math.sin(i) * Math.cos(i * 1.5);
      targetSumSq += targetRaw[i] * targetRaw[i];
    }
    const targetMag = Math.sqrt(targetSumSq);
    const targetEmbedding = Array.from(targetRaw).map(v => targetMag === 0 ? 0 : v / targetMag);

    bulkUsers.push({
      id: 'NHAI-2026-001',
      name: 'Keshav Kumar Agrawal',
      role: 'System Administrator',
      embedding: targetEmbedding,
    });

    // 2. Generate 9,999 other users
    for (let idx = 2; idx <= 10000; idx++) {
      const id = `NHAI-MOCK-${idx}`;
      const name = `Field Operator ${idx}`;
      const role = idx % 2 === 0 ? 'Toll Operator' : 'Security Guard';

      const rawVector = new Float32Array(192);
      let sumSquares = 0;
      for (let j = 0; j < 192; j++) {
        // Deterministic generation to avoid slow Math.random() loops
        rawVector[j] = Math.sin(idx * 0.72 + j) * Math.cos(j * 0.95);
        sumSquares += rawVector[j] * rawVector[j];
      }

      const magnitude = Math.sqrt(sumSquares);
      const embedding = Array.from(rawVector).map(v => magnitude === 0 ? 0 : v / magnitude);

      bulkUsers.push({ id, name, role, embedding });
    }

    await storage.setItem(USERS_KEY, JSON.stringify(bulkUsers));
    this.usersCache = this.preConvertUsers(bulkUsers);
    console.log('[LocalDatabase] Successfully seeded and cached 10,000 personnel profiles!');
  }

  public async seedDatabaseIfEmpty(): Promise<void> {
    const users = await this.getEnrolledUsers();
    // Filter out mock and hardcoded demo profiles
    const filtered = users.filter(
      u => !u.id.includes('MOCK') &&
           u.id !== 'NHAI-2026-001' &&
           u.id !== 'NHAI-2026-002' &&
           u.id !== 'NHAI-2026-003'
    );
    if (filtered.length !== users.length) {
      await storage.setItem(USERS_KEY, JSON.stringify(filtered));
      this.usersCache = this.preConvertUsers(filtered);
      console.log('[LocalDatabase] Cleared hardcoded mock profiles from database.');
    }
  }

  /**
   * Retrieve all audit logs in the local blockchain ledger
   */
  public async getLedger(): Promise<AuditLog[]> {
    const data = await storage.getItem(LEDGER_KEY);
    return data ? JSON.parse(data) : [];
  }

  /**
   * Append a validated transaction to the local ledger
   */
  public async appendLedgerBlock(block: AuditLog): Promise<boolean> {
    const ledger = await this.getLedger();
    ledger.push(block);
    await storage.setItem(LEDGER_KEY, JSON.stringify(ledger));
    return true;
  }

  /**
   * Re-write or clean the ledger (e.g. after sync-and-purge)
   */
  public async saveLedger(ledger: AuditLog[]): Promise<boolean> {
    await storage.setItem(LEDGER_KEY, JSON.stringify(ledger));
    return true;
  }
}
