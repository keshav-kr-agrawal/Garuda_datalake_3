/**
 * localDbAdapter.ts
 *
 * Unified local storage adapter for NHAI Garuda offline module.
 *
 * ARCHITECTURE:
 *   Web  (Vite/Browser) → IndexedDB
 *     - Persistent across page reloads
 *     - Private per-origin (each device/browser is isolated)
 *     - Up to 1GB storage (vs localStorage's 5MB cap)
 *     - Works fully offline, survives browser restarts
 *
 *   Mobile (React Native) → AsyncStorage
 *     - SQLite-backed on Android
 *     - NSUserDefaults-backed on iOS
 *     - Private per-app — no other app can read it
 *     - Works without internet
 *
 * LOCAL-FIRST GUARANTEE:
 *   Every user who installs the app gets their own isolated database.
 *   No internet needed for any read/write operation.
 *   When internet is restored, a sync job uploads & purges the local data.
 *
 * USAGE:
 *   import { LocalDbAdapter } from './localDbAdapter';
 *   const db = LocalDbAdapter.getInstance();
 *   await db.setItem('@nhai_key', JSON.stringify(data));
 *   const raw = await db.getItem('@nhai_key');
 */

// ─── Environment detection ────────────────────────────────────────────────────

const IS_WEB = typeof window !== 'undefined'
  && typeof (window as any).indexedDB !== 'undefined'
  && typeof document !== 'undefined';

// ─── IndexedDB constants ──────────────────────────────────────────────────────

const IDB_NAME    = 'garuda_local_db';
const IDB_VERSION = 1;
const IDB_STORE   = 'kv_store';   // Single key-value object store, mirrors AsyncStorage API

// ─── IndexedDB Helper ─────────────────────────────────────────────────────────

class IndexedDbStorage {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);

      req.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };

      req.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        console.log('[LocalDbAdapter] IndexedDB opened successfully (Web offline storage).');
        resolve();
      };

      req.onerror = (event) => {
        console.error('[LocalDbAdapter] IndexedDB open failed:', (event.target as IDBOpenDBRequest).error);
        reject((event.target as IDBOpenDBRequest).error);
      };
    });

    return this.initPromise;
  }

  async getItem(key: string): Promise<string | null> {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx  = this.db!.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror   = () => reject(req.error);
    });
  }

  async setItem(key: string, value: string): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx  = this.db!.transaction(IDB_STORE, 'readwrite');
      const req = tx.objectStore(IDB_STORE).put(value, key);
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  }

  async removeItem(key: string): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx  = this.db!.transaction(IDB_STORE, 'readwrite');
      const req = tx.objectStore(IDB_STORE).delete(key);
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  }

  async multiRemove(keys: string[]): Promise<void> {
    await Promise.all(keys.map(k => this.removeItem(k)));
  }

  async clear(): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx  = this.db!.transaction(IDB_STORE, 'readwrite');
      const req = tx.objectStore(IDB_STORE).clear();
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  }
}

// ─── AsyncStorage wrapper (React Native) ─────────────────────────────────────

class AsyncStorageAdapter {
  private storage: any = null;

  private getStorage(): any {
    if (!this.storage) {
      try {
        // Dynamic require to avoid import errors in web builds
        this.storage = require('@react-native-async-storage/async-storage').default;
      } catch {
        // Fallback: use in-memory store when AsyncStorage unavailable (tests/web-mocks)
        const mem = new Map<string, string>();
        this.storage = {
          getItem:    (k: string) => Promise.resolve(mem.get(k) ?? null),
          setItem:    (k: string, v: string) => { mem.set(k, v); return Promise.resolve(); },
          removeItem: (k: string) => { mem.delete(k); return Promise.resolve(); },
          multiRemove:(keys: string[]) => { keys.forEach(k => mem.delete(k)); return Promise.resolve(); },
          clear:      () => { mem.clear(); return Promise.resolve(); },
        };
      }
    }
    return this.storage;
  }

  getItem(key: string): Promise<string | null> {
    return this.getStorage().getItem(key);
  }

  setItem(key: string, value: string): Promise<void> {
    return this.getStorage().setItem(key, value);
  }

  removeItem(key: string): Promise<void> {
    return this.getStorage().removeItem(key);
  }

  multiRemove(keys: string[]): Promise<void> {
    return this.getStorage().multiRemove(keys);
  }

  clear(): Promise<void> {
    return this.getStorage().clear();
  }
}

// ─── Unified Adapter ─────────────────────────────────────────────────────────

export interface ILocalDbAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  multiRemove(keys: string[]): Promise<void>;
  clear(): Promise<void>;
}

export class LocalDbAdapter implements ILocalDbAdapter {
  private static instance: LocalDbAdapter;
  private backend: ILocalDbAdapter;
  public readonly storageType: 'indexeddb' | 'asyncstorage';

  private constructor() {
    if (IS_WEB) {
      this.backend     = new IndexedDbStorage();
      this.storageType = 'indexeddb';
      console.log('[LocalDbAdapter] Using IndexedDB (Web offline-first storage)');
    } else {
      this.backend     = new AsyncStorageAdapter();
      this.storageType = 'asyncstorage';
      console.log('[LocalDbAdapter] Using AsyncStorage (React Native offline storage)');
    }
  }

  public static getInstance(): LocalDbAdapter {
    if (!LocalDbAdapter.instance) {
      LocalDbAdapter.instance = new LocalDbAdapter();
    }
    return LocalDbAdapter.instance;
  }

  getItem(key: string): Promise<string | null> {
    return this.backend.getItem(key);
  }

  setItem(key: string, value: string): Promise<void> {
    return this.backend.setItem(key, value);
  }

  removeItem(key: string): Promise<void> {
    return this.backend.removeItem(key);
  }

  multiRemove(keys: string[]): Promise<void> {
    return this.backend.multiRemove(keys);
  }

  /**
   * Wipes the entire local database.
   * Called after a successful AWS sync-and-purge to free device storage.
   * The next time the user uses the app, it seeds from the server roster again.
   */
  clear(): Promise<void> {
    return this.backend.clear();
  }
}
