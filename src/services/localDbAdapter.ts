/**
 * localDbAdapter.ts
 *
 * Unified local storage adapter for NHAI Garuda offline module.
 *
 * ARCHITECTURE:
 *   Web  (Vite/Browser) → SQLiteEngine (Persisted in IndexedDB)
 *     - Uses sql.js WebAssembly (WASM) compiled version of real SQLite
 *     - Translates all getItem/setItem calls to SQL queries
 *     - Displays queries in the live local terminal
 *     - Private per-origin
 *     - Survives restarts
 *
 *   Mobile (React Native) → AsyncStorage
 *     - SQLite-backed on Android
 */

import initSqlJs from 'sql.js/dist/sql-asm.js';
import { Database, SqlJsStatic } from 'sql.js';

// ─── Environment detection ────────────────────────────────────────────────────

const IS_WEB = typeof window !== 'undefined'
  && typeof (window as any).indexedDB !== 'undefined'
  && typeof document !== 'undefined';

// ─── SQLite Query Log Interface ──────────────────────────────────────────────

export interface SqlLogEntry {
  statement: string;
  timestamp: string;
  latencyMs: number;
  rowsAffected: number;
}

// ─── Real Browser SQLite Database Engine using WebAssembly ────────────────────

export class SQLiteEngine {
  private static instance: SQLiteEngine;
  private SQL: SqlJsStatic | null = null;
  private db: Database | null = null;
  private initPromise: Promise<void> | null = null;
  private logs: SqlLogEntry[] = [];
  private logListeners: ((logs: SqlLogEntry[]) => void)[] = [];

  private constructor() {
    this.init();
  }

  public static getInstance(): SQLiteEngine {
    if (!SQLiteEngine.instance) {
      SQLiteEngine.instance = new SQLiteEngine();
    }
    return SQLiteEngine.instance;
  }

  public subscribe(listener: (logs: SqlLogEntry[]) => void) {
    this.logListeners.push(listener);
    listener(this.logs);
    return () => {
      this.logListeners = this.logListeners.filter(l => l !== listener);
    };
  }

  private notify() {
    this.logListeners.forEach(l => l([...this.logs]));
  }

  private logQuery(statement: string, latencyMs: number, rowsAffected: number) {
    this.logs.unshift({
      statement,
      timestamp: new Date().toLocaleTimeString('en-IN') + '.' + String(Date.now() % 1000).padStart(3, '0'),
      latencyMs,
      rowsAffected
    });
    if (this.logs.length > 50) {
      this.logs.pop();
    }
    this.notify();
  }

  private loadBinaryFromIndexedDB(): Promise<Uint8Array | null> {
    return new Promise((resolve) => {
      const req = indexedDB.open('garuda_sqlite_wasm_db', 1);
      req.onupgradeneeded = (e) => {
        const db = (e.target as any).result;
        if (!db.objectStoreNames.contains('sqlite_binary_store')) {
          db.createObjectStore('sqlite_binary_store');
        }
      };
      req.onsuccess = (e) => {
        const db = (e.target as any).result;
        const tx = db.transaction('sqlite_binary_store', 'readonly');
        const storeReq = tx.objectStore('sqlite_binary_store').get('wasm_db_binary');
        storeReq.onsuccess = () => {
          const val = storeReq.result;
          if (val instanceof Uint8Array) {
            resolve(val);
          } else {
            resolve(null);
          }
        };
        storeReq.onerror = () => resolve(null);
      };
      req.onerror = () => resolve(null);
    });
  }

  private saveBinaryToIndexedDB(binary: Uint8Array): Promise<void> {
    return new Promise((resolve) => {
      const req = indexedDB.open('garuda_sqlite_wasm_db', 1);
      req.onupgradeneeded = (e) => {
        const db = (e.target as any).result;
        if (!db.objectStoreNames.contains('sqlite_binary_store')) {
          db.createObjectStore('sqlite_binary_store');
        }
      };
      req.onsuccess = (e) => {
        const db = (e.target as any).result;
        const tx = db.transaction('sqlite_binary_store', 'readwrite');
        const storeReq = tx.objectStore('sqlite_binary_store').put(binary, 'wasm_db_binary');
        storeReq.onsuccess = () => resolve();
        storeReq.onerror = () => resolve();
      };
      req.onerror = () => resolve();
    });
  }

  public async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise(async (resolve, reject) => {
      try {
        this.SQL = await initSqlJs();
        
        const savedBinary = await this.loadBinaryFromIndexedDB();
        if (savedBinary) {
          this.db = new this.SQL.Database(savedBinary);
          console.log('[SQLiteEngine] Loaded SQLite WASM Database from persistent storage.');
        } else {
          this.db = new this.SQL.Database();
          console.log('[SQLiteEngine] Created new in-memory SQLite WASM Database.');
        }

        // One-time database reset for June 5 updates (clear old schema & data)
        const RESET_KEY = '@nhai_db_cleared_june_05_v5';
        if (typeof window !== 'undefined' && !window.localStorage.getItem(RESET_KEY)) {
          console.log('[SQLiteEngine] Performing one-time SQLite database reset...');
          try {
            // Drop existing tables
            this.db.run('DROP TABLE IF EXISTS enrolled_users;');
            this.db.run('DROP TABLE IF EXISTS cryptographic_ledger;');
            this.db.run('DROP TABLE IF EXISTS offline_attendance_queue;');
            this.db.run('DROP TABLE IF EXISTS device_settings;');
            
            // Clean local storage cache keys
            window.localStorage.removeItem('@nhai_enrolled_users');
            window.localStorage.removeItem('@nhai_audit_ledger');
            window.localStorage.removeItem('@nhai_offline_queue');
            window.localStorage.removeItem('@avatar_NHAI-2026-001');
            window.localStorage.removeItem('@avatar_NHAI-2026-002');
            window.localStorage.removeItem('@avatar_NHAI-2026-003');

            window.localStorage.setItem(RESET_KEY, 'true');
            console.log('[SQLiteEngine] One-time database reset complete.');
          } catch (resetErr) {
            console.error('[SQLiteEngine] Error during one-time database reset:', resetErr);
          }
        }
        
        // Setup SQLite Schemas
        this.db.run(`
          CREATE TABLE IF NOT EXISTS enrolled_users (
            id TEXT PRIMARY KEY,
            name TEXT,
            role TEXT,
            embedding TEXT,
            faceModel TEXT,
            syncStatus TEXT
          );
        `);

        // Check if faceModel column exists and add it if missing
        try {
          const tableInfo = this.db.exec("PRAGMA table_info(enrolled_users);");
          if (tableInfo && tableInfo.length > 0) {
            const columns = tableInfo[0].values.map((col: any) => col[1]);
            if (!columns.includes('faceModel')) {
              console.log('[SQLiteEngine] faceModel column is missing in enrolled_users. Running ALTER TABLE...');
              this.db.run("ALTER TABLE enrolled_users ADD COLUMN faceModel TEXT;");
              const binary = this.db.export();
              await this.saveBinaryToIndexedDB(binary);
              console.log('[SQLiteEngine] faceModel column added successfully.');
            }
          }
        } catch (migrationErr) {
          console.error('[SQLiteEngine] Error running auto-migration for faceModel:', migrationErr);
        }

        this.db.run(`
          CREATE TABLE IF NOT EXISTS cryptographic_ledger (
            id TEXT PRIMARY KEY,
            timestamp INTEGER,
            userId TEXT,
            latitude REAL,
            longitude REAL,
            confidence REAL,
            status TEXT,
            hash TEXT,
            prevHash TEXT
          );
        `);
        this.db.run(`
          CREATE TABLE IF NOT EXISTS offline_attendance_queue (
            localId TEXT PRIMARY KEY,
            employeeId TEXT,
            gpsLatitude REAL,
            gpsLongitude REAL,
            gpsAccuracyMeters REAL,
            matchConfidence REAL,
            livenessScore REAL,
            enqueuedAt INTEGER,
            syncStatus TEXT
          );
        `);
        this.db.run(`
          CREATE TABLE IF NOT EXISTS device_settings (
            key TEXT PRIMARY KEY,
            value TEXT
          );
        `);
        
        resolve();
      } catch (err) {
        console.error('[SQLiteEngine] Initialization error:', err);
        reject(err);
      }
    });

    return this.initPromise;
  }

  public async runQuery(sql: string, params: any[] = []): Promise<any> {
    await this.init();
    if (!this.db) throw new Error('[SQLiteEngine] SQLite not initialized.');

    const t0 = performance.now();
    let result: any = null;
    let rowsAffected = 0;

    const queryLower = sql.trim().toLowerCase();

    try {
      if (queryLower.startsWith('select')) {
        const stmt = this.db.prepare(sql);
        stmt.bind(params);
        const values: any[] = [];
        while (stmt.step()) {
          values.push(stmt.get());
        }
        const columns = stmt.getColumnNames();
        stmt.free();

        result = values.map((row) => {
          const obj: any = {};
          columns.forEach((col, idx) => {
            obj[col] = row[idx];
          });
          return obj;
        });
        rowsAffected = result.length;
      } else {
        this.db.run(sql, params);
        rowsAffected = this.db.getRowsModified();
        
        const binary = this.db.export();
        await this.saveBinaryToIndexedDB(binary);
      }
    } catch (err) {
      console.error('[SQLiteEngine] SQL execution failed:', sql, params, err);
      this.logQuery(`${sql} -- ERROR: ${String(err)}`, Number((performance.now() - t0).toFixed(3)), 0);
      throw err;
    }

    const latencyMs = Number((performance.now() - t0).toFixed(3));
    let displaySql = sql;
    if (params.length > 0) {
      let paramIdx = 0;
      displaySql = sql.replace(/\?/g, () => {
        const val = params[paramIdx++];
        if (typeof val === 'string') return `'${val}'`;
        if (Array.isArray(val)) return `[Array(${val.length})]`;
        return String(val);
      });
    }
    this.logQuery(displaySql, latencyMs, rowsAffected);
    return result;
  }
}

// ─── SQL-Mapped Storage Adapter for Browser ───────────────────────────────────

class SQLiteStorageAdapter implements ILocalDbAdapter {
  private engine = SQLiteEngine.getInstance();

  async getItem(key: string): Promise<string | null> {
    if (key === '@nhai_enrolled_users') {
      const rows = await this.engine.runQuery('SELECT * FROM enrolled_users;');
      if (rows && rows.length > 0) {
        // Embeddings and faceModel are JSON stringified inside SQLite, parse them back
        const parsedRows = rows.map((r: any) => ({
          ...r,
          embedding: typeof r.embedding === 'string' ? JSON.parse(r.embedding) : r.embedding,
          faceModel: r.faceModel && typeof r.faceModel === 'string' ? JSON.parse(r.faceModel) : undefined
        }));
        return JSON.stringify(parsedRows);
      }
      return null;
    }
    if (key === '@nhai_cryptographic_ledger') {
      const rows = await this.engine.runQuery('SELECT * FROM cryptographic_ledger;');
      return rows && rows.length > 0 ? JSON.stringify(rows) : null;
    }
    if (key === '@nhai_offline_queue') {
      const rows = await this.engine.runQuery('SELECT * FROM offline_attendance_queue;');
      return rows && rows.length > 0 ? JSON.stringify(rows) : null;
    }
    
    const rows = await this.engine.runQuery('SELECT value FROM device_settings WHERE key = ?;', [key]);
    return rows && rows.length > 0 ? rows[0].value : null;
  }

  async setItem(key: string, value: string): Promise<void> {
    if (key === '@nhai_enrolled_users') {
      await this.engine.runQuery('DELETE FROM enrolled_users;');
      const list = JSON.parse(value) as any[];
      for (const u of list) {
        await this.engine.runQuery(
          'INSERT OR REPLACE INTO enrolled_users (id, name, role, embedding, faceModel, syncStatus) VALUES (?, ?, ?, ?, ?, ?);',
          [u.id, u.name, u.role, JSON.stringify(u.embedding), u.faceModel ? JSON.stringify(u.faceModel) : null, u.syncStatus ?? 'SYNCED']
        );
      }
      return;
    }
    if (key === '@nhai_cryptographic_ledger') {
      await this.engine.runQuery('DELETE FROM cryptographic_ledger;');
      const list = JSON.parse(value) as any[];
      for (const l of list) {
        await this.engine.runQuery(
          'INSERT OR REPLACE INTO cryptographic_ledger (id, timestamp, userId, latitude, longitude, confidence, status, hash, prevHash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);',
          [l.id, l.timestamp, l.userId, l.latitude, l.longitude, l.confidence, l.status, l.hash, l.prevHash]
        );
      }
      return;
    }
    if (key === '@nhai_offline_queue') {
      await this.engine.runQuery('DELETE FROM offline_attendance_queue;');
      const list = JSON.parse(value) as any[];
      for (const q of list) {
        await this.engine.runQuery(
          'INSERT OR REPLACE INTO offline_attendance_queue (localId, employeeId, gpsLatitude, gpsLongitude, gpsAccuracyMeters, matchConfidence, livenessScore, enqueuedAt, syncStatus) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);',
          [q.localId, q.employeeId, q.gpsLatitude, q.gpsLongitude, q.gpsAccuracyMeters, q.matchConfidence, q.livenessScore, q.enqueuedAt, q.syncStatus]
        );
      }
      return;
    }

    await this.engine.runQuery('INSERT OR REPLACE INTO device_settings (key, value) VALUES (?, ?);', [key, value]);
  }

  async removeItem(key: string): Promise<void> {
    if (key === '@nhai_enrolled_users') {
      await this.engine.runQuery('DELETE FROM enrolled_users;');
      return;
    }
    if (key === '@nhai_cryptographic_ledger') {
      await this.engine.runQuery('DELETE FROM cryptographic_ledger;');
      return;
    }
    if (key === '@nhai_offline_queue') {
      await this.engine.runQuery('DELETE FROM offline_attendance_queue;');
      return;
    }
    await this.engine.runQuery('DELETE FROM device_settings WHERE key = ?;', [key]);
  }

  async multiRemove(keys: string[]): Promise<void> {
    for (const key of keys) {
      await this.removeItem(key);
    }
  }

  async clear(): Promise<void> {
    await this.engine.runQuery('DELETE FROM enrolled_users;');
    await this.engine.runQuery('DELETE FROM cryptographic_ledger;');
    await this.engine.runQuery('DELETE FROM offline_attendance_queue;');
    await this.engine.runQuery('DELETE FROM device_settings;');
  }
}

// ─── AsyncStorage wrapper (React Native) ─────────────────────────────────────

class AsyncStorageAdapter {
  private storage: any = null;

  private getStorage(): any {
    if (!this.storage) {
      try {
        this.storage = require('@react-native-async-storage/async-storage').default;
      } catch {
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
  public readonly storageType: 'sqlite' | 'asyncstorage';

  private constructor() {
    if (IS_WEB) {
      this.backend     = new SQLiteStorageAdapter();
      this.storageType = 'sqlite';
      console.log('[LocalDbAdapter] Using actual browser-simulated WebAssembly SQLite engine');
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

  clear(): Promise<void> {
    return this.backend.clear();
  }
}
