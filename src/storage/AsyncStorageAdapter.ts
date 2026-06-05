/**
 * AsyncStorageAdapter — React Native storage adapter.
 *
 * Wraps @react-native-async-storage/async-storage as an IStorageAdapter.
 * The async-storage package must be installed separately in the consumer's
 * React Native project.
 *
 * @example
 * ```ts
 * import { AsyncStorageAdapter, LocalDatabase } from 'nhai-garuda';
 * import AsyncStorage from '@react-native-async-storage/async-storage';
 *
 * const adapter = new AsyncStorageAdapter(AsyncStorage);
 * const db = new LocalDatabase(adapter);
 * ```
 */

import type { IStorageAdapter } from '../types';

/** The shape of the AsyncStorage module from @react-native-async-storage */
export interface AsyncStorageModule {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  multiRemove?(keys: string[]): Promise<void>;
  clear?(): Promise<void>;
}

export class AsyncStorageAdapter implements IStorageAdapter {
  private readonly asyncStorage: AsyncStorageModule;

  /**
   * @param asyncStorage  The AsyncStorage module. Pass the default export
   *                      from @react-native-async-storage/async-storage.
   */
  constructor(asyncStorage: AsyncStorageModule) {
    this.asyncStorage = asyncStorage;
  }

  async getItem(key: string): Promise<string | null> {
    return this.asyncStorage.getItem(key);
  }

  async setItem(key: string, value: string): Promise<void> {
    return this.asyncStorage.setItem(key, value);
  }

  async removeItem(key: string): Promise<void> {
    return this.asyncStorage.removeItem(key);
  }

  async multiRemove(keys: string[]): Promise<void> {
    if (this.asyncStorage.multiRemove) {
      return this.asyncStorage.multiRemove(keys);
    }
    for (const key of keys) {
      await this.asyncStorage.removeItem(key);
    }
  }

  async clear(): Promise<void> {
    if (this.asyncStorage.clear) {
      return this.asyncStorage.clear();
    }
  }
}
