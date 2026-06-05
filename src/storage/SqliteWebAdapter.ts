/**
 * SqliteWebAdapter — Browser SQLite storage adapter using sql.js WASM.
 *
 * Provides a real SQLite database in the browser, persisted to IndexedDB.
 * Requires `sql.js` as a peer dependency.
 *
 * @example
 * ```ts
 * import { SqliteWebAdapter, LocalDatabase } from 'nhai-garuda';
 *
 * const adapter = new SqliteWebAdapter();
 * await adapter.initialize();
 * const db = new LocalDatabase(adapter);
 * ```
 */

import type { IStorageAdapter, SqlLogEntry } from '../types';

export class SqliteWebAdapter implements IStorageAdapter {
  private SQL: any = null;
  private db: any = null;
  private initPromise: Promise<void> | null = null;
  private logs: SqlLogEntry[] = [];
  private logListeners: ((logs: SqlLogEntry[]) => void)[] = [];
  private readonly maxLogs: number;
  private readonly initSqlJs: (() => Promise<any>) | null;

  /**
   * @param options.initSqlJs  Function that returns the sql.js module.
   *                           If not provided, will try to import 'sql.js/dist/sql-asm.js'.
   * @param options.maxLogs    Max number of query log entries to retain (default: 50).
   */
  constructor(options?: {
    initSqlJs?: () => Promise<any>;
    maxLogs?: number;
  }) {
    this.initSqlJs = options?.initSqlJs ?? null;
    this.maxLogs = options?.maxLogs ?? 50;
  }

  /** Subscribe to live SQL query logs. Returns an unsubscribe function. */
  public subscribe(listener: (logs: SqlLogEntry[]) => void): () => void {
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
    if (this.logs.length > this.maxLogs) this.logs.pop();
    this.notify();
  }

  // ─── IndexedDB Persistence ──────────────────────────────────────────────────

  private loadBinaryFromIndexedDB(): Promise<Uint8Array | null> {
    return new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
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
          resolve(storeReq.result instanceof Uint8Array ? storeReq.result : null);
        };
        storeReq.onerror = () => resolve(null);
      };
      req.onerror = () => resolve(null);
    });
  }

  private saveBinaryToIndexedDB(binary: Uint8Array): Promise<void> {
    return new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') { resolve(); return; }
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

  // ─── Initialization ─────────────────────────────────────────────────────────

  public async initialize(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      if (this.initSqlJs) {
        this.SQL = await this.initSqlJs();
      } else {
        // Dynamic import — sql.js must be installed as peer dep
        const initFn = (await import('sql.js/dist/sql-asm.js')).default;
        this.SQL = await initFn();
      }

      const savedBinary = await this.loadBinaryFromIndexedDB();
      this.db = savedBinary
        ? new this.SQL.Database(savedBinary)
        : new this.SQL.Database();

      // Create tables
      this.db.run(`
        CREATE TABLE IF NOT EXISTS enrolled_users (
          id TEXT PRIMARY KEY, name TEXT, role TEXT,
          embedding TEXT, faceModel TEXT, syncStatus TEXT
        );
      `);
      this.db.run(`
        CREATE TABLE IF NOT EXISTS cryptographic_ledger (
          id TEXT PRIMARY KEY, timestamp INTEGER, userId TEXT,
          latitude REAL, longitude REAL, confidence REAL,
          status TEXT, hash TEXT, prevHash TEXT
        );
      `);
      this.db.run(`
        CREATE TABLE IF NOT EXISTS offline_attendance_queue (
          localId TEXT PRIMARY KEY, employeeId TEXT,
          gpsLatitude REAL, gpsLongitude REAL, gpsAccuracyMeters REAL,
          matchConfidence REAL, livenessScore REAL,
          enqueuedAt INTEGER, syncStatus TEXT
        );
      `);
      this.db.run(`
        CREATE TABLE IF NOT EXISTS device_settings (
          key TEXT PRIMARY KEY, value TEXT
        );
      `);

      // Ensure faceModel column exists
      try {
        const tableInfo = this.db.exec("PRAGMA table_info(enrolled_users);");
        if (tableInfo?.length > 0) {
          const columns = tableInfo[0].values.map((col: any) => col[1]);
          if (!columns.includes('faceModel')) {
            this.db.run("ALTER TABLE enrolled_users ADD COLUMN faceModel TEXT;");
            await this.saveBinaryToIndexedDB(this.db.export());
          }
        }
      } catch { /* migration already done */ }
    })();

    return this.initPromise;
  }

  /** Execute a raw SQL query. Returns result rows for SELECT, null for mutations. */
  public async runQuery(sql: string, params: any[] = []): Promise<any> {
    await this.initialize();
    if (!this.db) throw new Error('SQLite not initialized.');

    const t0 = performance.now();
    let result: any = null;
    let rowsAffected = 0;
    const queryLower = sql.trim().toLowerCase();

    try {
      if (queryLower.startsWith('select')) {
        const stmt = this.db.prepare(sql);
        stmt.bind(params);
        const values: any[] = [];
        while (stmt.step()) values.push(stmt.get());
        const columns = stmt.getColumnNames();
        stmt.free();

        result = values.map((row: any) => {
          const obj: any = {};
          columns.forEach((col: string, idx: number) => { obj[col] = row[idx]; });
          return obj;
        });
        rowsAffected = result.length;
      } else {
        this.db.run(sql, params);
        rowsAffected = this.db.getRowsModified();
        await this.saveBinaryToIndexedDB(this.db.export());
      }
    } catch (err) {
      this.logQuery(`${sql} -- ERROR: ${String(err)}`, Number((performance.now() - t0).toFixed(3)), 0);
      throw err;
    }

    this.logQuery(sql, Number((performance.now() - t0).toFixed(3)), rowsAffected);
    return result;
  }

  // ─── IStorageAdapter Implementation ─────────────────────────────────────────

  async getItem(key: string): Promise<string | null> {
    await this.initialize();
    if (key === '@nhai_enrolled_users') {
      const rows = await this.runQuery('SELECT * FROM enrolled_users;');
      if (rows?.length > 0) {
        const parsed = rows.map((r: any) => ({
          ...r,
          embedding: typeof r.embedding === 'string' ? JSON.parse(r.embedding) : r.embedding,
          faceModel: r.faceModel && typeof r.faceModel === 'string' ? JSON.parse(r.faceModel) : undefined,
        }));
        return JSON.stringify(parsed);
      }
      return null;
    }
    if (key === '@nhai_cryptographic_ledger') {
      const rows = await this.runQuery('SELECT * FROM cryptographic_ledger;');
      return rows?.length > 0 ? JSON.stringify(rows) : null;
    }
    if (key === '@nhai_offline_queue') {
      const rows = await this.runQuery('SELECT * FROM offline_attendance_queue;');
      return rows?.length > 0 ? JSON.stringify(rows) : null;
    }
    const rows = await this.runQuery('SELECT value FROM device_settings WHERE key = ?;', [key]);
    return rows?.length > 0 ? rows[0].value : null;
  }

  async setItem(key: string, value: string): Promise<void> {
    await this.initialize();
    if (key === '@nhai_enrolled_users') {
      await this.runQuery('DELETE FROM enrolled_users;');
      const list = JSON.parse(value);
      for (const u of list) {
        await this.runQuery(
          'INSERT OR REPLACE INTO enrolled_users (id, name, role, embedding, faceModel, syncStatus) VALUES (?, ?, ?, ?, ?, ?);',
          [u.id, u.name, u.role, JSON.stringify(u.embedding), u.faceModel ? JSON.stringify(u.faceModel) : null, u.syncStatus ?? 'SYNCED']
        );
      }
      return;
    }
    if (key === '@nhai_cryptographic_ledger') {
      await this.runQuery('DELETE FROM cryptographic_ledger;');
      const list = JSON.parse(value);
      for (const l of list) {
        await this.runQuery(
          'INSERT OR REPLACE INTO cryptographic_ledger (id, timestamp, userId, latitude, longitude, confidence, status, hash, prevHash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);',
          [l.id, l.timestamp, l.userId, l.latitude, l.longitude, l.confidence, l.status, l.hash, l.prevHash]
        );
      }
      return;
    }
    if (key === '@nhai_offline_queue') {
      await this.runQuery('DELETE FROM offline_attendance_queue;');
      const list = JSON.parse(value);
      for (const q of list) {
        await this.runQuery(
          'INSERT OR REPLACE INTO offline_attendance_queue (localId, employeeId, gpsLatitude, gpsLongitude, gpsAccuracyMeters, matchConfidence, livenessScore, enqueuedAt, syncStatus) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);',
          [q.localId, q.employeeId, q.gpsLatitude, q.gpsLongitude, q.gpsAccuracyMeters, q.matchConfidence, q.livenessScore, q.enqueuedAt, q.syncStatus]
        );
      }
      return;
    }
    await this.runQuery('INSERT OR REPLACE INTO device_settings (key, value) VALUES (?, ?);', [key, value]);
  }

  async removeItem(key: string): Promise<void> {
    await this.initialize();
    if (key === '@nhai_enrolled_users') { await this.runQuery('DELETE FROM enrolled_users;'); return; }
    if (key === '@nhai_cryptographic_ledger') { await this.runQuery('DELETE FROM cryptographic_ledger;'); return; }
    if (key === '@nhai_offline_queue') { await this.runQuery('DELETE FROM offline_attendance_queue;'); return; }
    await this.runQuery('DELETE FROM device_settings WHERE key = ?;', [key]);
  }

  async multiRemove(keys: string[]): Promise<void> {
    for (const key of keys) await this.removeItem(key);
  }

  async clear(): Promise<void> {
    await this.initialize();
    await this.runQuery('DELETE FROM enrolled_users;');
    await this.runQuery('DELETE FROM cryptographic_ledger;');
    await this.runQuery('DELETE FROM offline_attendance_queue;');
    await this.runQuery('DELETE FROM device_settings;');
  }
}
