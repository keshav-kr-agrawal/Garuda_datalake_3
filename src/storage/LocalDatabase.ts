/**
 * LocalDatabase — Local biometric database with vector search.
 *
 * Stores enrolled user profiles with face embeddings and provides
 * high-performance cosine similarity search for 1:N face matching.
 *
 * Storage backend is pluggable via IStorageAdapter.
 *
 * @example
 * ```ts
 * import { LocalDatabase, MemoryStorageAdapter } from 'nhai-garuda';
 *
 * const db = new LocalDatabase(new MemoryStorageAdapter());
 * await db.enrollUser({ id: 'user-1', name: 'John', role: 'Guard', embedding: [...] });
 * const result = await db.vectorSearch(queryEmbedding);
 * ```
 */

import type { EnrolledUser, AuditLog, IStorageAdapter, AngleEmbedding } from '../types';
import type { LedgerStorage } from '../crypto/AuditLedger';

// Re-export for convenience
export type { EnrolledUser, AuditLog };

const USERS_KEY = '@nhai_enrolled_users';
const LEDGER_KEY = '@nhai_cryptographic_ledger';

export class LocalDatabase implements LedgerStorage {
  private static _instance: LocalDatabase | null = null;

  private readonly storage: IStorageAdapter;
  private usersCache: EnrolledUser[] | null = null;

  constructor(storage: IStorageAdapter) {
    this.storage = storage;
  }

  /** Backward-compatible singleton (requires prior setup). */
  public static getInstance(): LocalDatabase {
    if (!LocalDatabase._instance) {
      throw new Error('LocalDatabase not initialized. Call new LocalDatabase(adapter) first.');
    }
    return LocalDatabase._instance;
  }

  public static setInstance(instance: LocalDatabase): void {
    LocalDatabase._instance = instance;
  }

  public static resetInstance(): void {
    LocalDatabase._instance = null;
  }

  // ─── Pre-conversion ─────────────────────────────────────────────────────────

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
          angleEmbeddings: u.faceModel.angleEmbeddings.map((a: AngleEmbedding) => ({
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

  // ─── User Management ────────────────────────────────────────────────────────

  /** Fetch all enrolled users (cached in memory for sub-ms access). */
  public async getEnrolledUsers(): Promise<EnrolledUser[]> {
    if (this.usersCache) return this.usersCache;
    const data = await this.storage.getItem(USERS_KEY);
    const parsed = data ? JSON.parse(data) : [];
    this.usersCache = this.preConvertUsers(parsed);
    return this.usersCache;
  }

  /** Enroll a new user (or update existing). */
  public async enrollUser(user: EnrolledUser): Promise<boolean> {
    const users = await this.getEnrolledUsers();
    const updated = users.filter(u => u.id !== user.id);
    updated.push(user);
    await this.storage.setItem(USERS_KEY, JSON.stringify(updated));
    this.usersCache = this.preConvertUsers(updated);
    return true;
  }

  /** Delete an enrolled user. */
  public async deleteUser(userId: string): Promise<boolean> {
    const users = await this.getEnrolledUsers();
    const updated = users.filter(u => u.id !== userId);
    await this.storage.setItem(USERS_KEY, JSON.stringify(updated));
    this.usersCache = this.preConvertUsers(updated);
    return true;
  }

  /** Invalidate the in-memory cache (force next read from storage). */
  public invalidateCache(): void {
    this.usersCache = null;
  }

  // ─── Vector Search ──────────────────────────────────────────────────────────

  /**
   * Optimized dot-product vector search across all enrolled users.
   * Checks masterEmbedding, legacy flat embedding, and frontal angle embeddings.
   * Excludes TURN_LEFT/TURN_RIGHT to prevent profile-angle false positives.
   */
  public async vectorSearch(queryEmbedding: Float32Array): Promise<{ user: EnrolledUser | null; similarity: number }> {
    const users = await this.getEnrolledUsers();
    let bestUser: EnrolledUser | null = null;
    let maxSimilarity = -1;
    const qLen = queryEmbedding.length;

    for (let i = 0; i < users.length; i++) {
      const user = users[i] as any;
      const candidateEmbeddings: Float32Array[] = [];

      if (user.embedding) {
        candidateEmbeddings.push(user._floatEmbedding || (user._floatEmbedding = new Float32Array(user.embedding)));
      }
      if (user.faceModel?.masterEmbedding) {
        candidateEmbeddings.push(user._masterFloatEmbedding || (user._masterFloatEmbedding = new Float32Array(user.faceModel.masterEmbedding)));
      }
      if (user.faceModel?.angleEmbeddings) {
        for (const angle of user.faceModel.angleEmbeddings) {
          if (angle.step !== 'TURN_LEFT' && angle.step !== 'TURN_RIGHT') {
            const angleKey = `_angle_${angle.step}`;
            if (!user[angleKey]) {
              user[angleKey] = new Float32Array(angle.embedding);
            }
            candidateEmbeddings.push(user[angleKey]);
          }
        }
      }

      let userBestSimilarity = -1;
      for (const dbEmbedding of candidateEmbeddings) {
        const len = Math.min(qLen, dbEmbedding.length);
        let dotProduct = 0;
        for (let j = 0; j < len; j++) {
          dotProduct += queryEmbedding[j] * dbEmbedding[j];
        }
        if (dotProduct > userBestSimilarity) {
          userBestSimilarity = dotProduct;
        }
      }

      if (userBestSimilarity > maxSimilarity) {
        maxSimilarity = userBestSimilarity;
        bestUser = user;
      }
    }

    return { user: bestUser, similarity: maxSimilarity };
  }

  /**
   * Multi-angle vector search using FaceEmbedder.detectFace().
   * Requires a detectFaceFn callback for decoupled operation.
   */
  public async vectorSearchMultiAngle(
    queryEmbedding: Float32Array,
    detectFaceFn?: (
      liveEmbedding: Float32Array,
      models: any[]
    ) => { match: boolean; userId: string | null; confidence: number; matchedAngle: string }
  ): Promise<{ user: EnrolledUser | null; similarity: number; matchedAngle: string }> {
    const users = await this.getEnrolledUsers();

    if (!detectFaceFn) {
      // Fallback to basic vector search
      const basic = await this.vectorSearch(queryEmbedding);
      return { ...basic, matchedAngle: 'master' };
    }

    const models = users.map(u => (u as any)._faceMeshModel);
    const detection = detectFaceFn(queryEmbedding, models);
    const matchedUser = users.find(u => u.id === detection.userId) ?? null;

    return {
      user: matchedUser,
      similarity: detection.confidence,
      matchedAngle: detection.matchedAngle,
    };
  }

  // ─── Ledger Operations (implements LedgerStorage) ───────────────────────────

  public async getLedger(): Promise<AuditLog[]> {
    const data = await this.storage.getItem(LEDGER_KEY);
    return data ? JSON.parse(data) : [];
  }

  public async appendLedgerBlock(block: AuditLog): Promise<boolean> {
    const ledger = await this.getLedger();
    ledger.push(block);
    await this.storage.setItem(LEDGER_KEY, JSON.stringify(ledger));
    return true;
  }

  public async saveLedger(ledger: AuditLog[]): Promise<boolean> {
    await this.storage.setItem(LEDGER_KEY, JSON.stringify(ledger));
    return true;
  }
}
