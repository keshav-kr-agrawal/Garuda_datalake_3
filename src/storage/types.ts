/**
 * Storage adapter interface for nhai-garuda.
 *
 * Implement this interface to provide a custom storage backend.
 * Two built-in adapters are provided:
 *   - SqliteWebAdapter (browser — sql.js WASM)
 *   - AsyncStorageAdapter (React Native)
 *
 * @example
 * ```ts
 * import { IStorageAdapter } from 'nhai-garuda';
 *
 * class MyCustomAdapter implements IStorageAdapter {
 *   async getItem(key: string) { return localStorage.getItem(key); }
 *   async setItem(key: string, value: string) { localStorage.setItem(key, value); }
 *   async removeItem(key: string) { localStorage.removeItem(key); }
 * }
 * ```
 */

export type { IStorageAdapter, SqlLogEntry } from '../types';

/**
 * Simple in-memory storage adapter. Useful for testing.
 */
export class MemoryStorageAdapter {
  private store = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.store.delete(key);
  }

  async multiRemove(keys: string[]): Promise<void> {
    keys.forEach(k => this.store.delete(k));
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}
