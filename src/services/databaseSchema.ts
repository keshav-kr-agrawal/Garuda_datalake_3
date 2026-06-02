import AsyncStorage from '@react-native-async-storage/async-storage';

export interface EnrolledUser {
  id: string;
  name: string;
  role: string;
  embedding: number[]; // 128-D vector saved as standard array
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
const LEDGER_KEY = '@nhai_audit_ledger';

export class LocalDatabaseService {
  private static instance: LocalDatabaseService;

  private constructor() {}

  public static getInstance(): LocalDatabaseService {
    if (!LocalDatabaseService.instance) {
      LocalDatabaseService.instance = new LocalDatabaseService();
    }
    return LocalDatabaseService.instance;
  }

  /**
   * Fetch all locally enrolled users
   */
  public async getEnrolledUsers(): Promise<EnrolledUser[]> {
    try {
      const data = await AsyncStorage.getItem(USERS_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('[LocalDatabase] Error getting users:', e);
      return [];
    }
  }

  /**
   * Save/Enroll a new user locally (for testing enrollment)
   */
  public async enrollUser(user: EnrolledUser): Promise<boolean> {
    try {
      const users = await this.getEnrolledUsers();
      // Remove duplicates if any
      const updated = users.filter(u => u.id !== user.id);
      updated.push(user);
      await AsyncStorage.setItem(USERS_KEY, JSON.stringify(updated));
      console.log(`[LocalDatabase] Successfully enrolled user: ${user.name} (${user.id})`);
      return true;
    } catch (e) {
      console.error('[LocalDatabase] Error enrolling user:', e);
      return false;
    }
  }

  /**
   * Bulk enroll pre-registered users on startup if empty (seeding Indian transit corridor roster)
   */
  public async seedDatabaseIfEmpty(): Promise<void> {
    const users = await this.getEnrolledUsers();
    if (users.length === 0) {
      console.log('[LocalDatabase] Seeding mock personnel vectors for hackathon demonstration...');
      
      // Generate some deterministic mock personnel embeddings
      const seedUsers: EnrolledUser[] = [
        {
          id: 'NHAI-2026-001',
          name: 'Keshav Kumar Agrawal',
          role: 'Toll Supervisor',
          embedding: Array.from({ length: 128 }, (_, i) => Math.sin(i) * Math.cos(i * 1.5))
        },
        {
          id: 'NHAI-2026-002',
          name: 'Harshiya Sharma',
          role: 'Checkpost Inspector',
          embedding: Array.from({ length: 128 }, (_, i) => Math.sin(i + 1) * Math.cos(i * 2.3))
        },
        {
          id: 'NHAI-2026-003',
          name: 'Anurag Mohapatra',
          role: 'Field Security Lead',
          embedding: Array.from({ length: 128 }, (_, i) => Math.sin(i + 2) * Math.cos(i * 0.9))
        }
      ];

      for (const u of seedUsers) {
        await this.enrollUser(u);
      }
    }
  }

  /**
   * Retrieve all audit logs in the local blockchain ledger
   */
  public async getLedger(): Promise<AuditLog[]> {
    try {
      const data = await AsyncStorage.getItem(LEDGER_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('[LocalDatabase] Error getting ledger:', e);
      return [];
    }
  }

  /**
   * Append a validated transaction to the local ledger
   */
  public async appendLedgerBlock(block: AuditLog): Promise<boolean> {
    try {
      const ledger = await this.getLedger();
      ledger.push(block);
      await AsyncStorage.setItem(LEDGER_KEY, JSON.stringify(ledger));
      return true;
    } catch (e) {
      console.error('[LocalDatabase] Error appending ledger block:', e);
      return false;
    }
  }

  /**
   * Re-write or clean the ledger (e.g. after sync-and-purge)
   */
  public async saveLedger(ledger: AuditLog[]): Promise<boolean> {
    try {
      await AsyncStorage.setItem(LEDGER_KEY, JSON.stringify(ledger));
      return true;
    } catch (e) {
      console.error('[LocalDatabase] Error saving ledger:', e);
      return false;
    }
  }
}
