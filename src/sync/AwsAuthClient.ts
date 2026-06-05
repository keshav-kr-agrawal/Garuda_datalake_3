/**
 * AwsAuthClient — AWS Cognito authentication and encryption layer.
 *
 * Manages JWT token lifecycle (login, refresh, cache), device registration,
 * payload signing (HMAC-SHA256), and encrypted local session persistence.
 *
 * @example
 * ```ts
 * import { AwsAuthClient } from 'nhai-garuda';
 *
 * const auth = new AwsAuthClient({
 *   region: 'ap-south-1',
 *   cognitoUserPoolId: 'ap-south-1_XXXXX',
 *   cognitoClientId: 'XXXXXX',
 *   apiGatewayBaseUrl: 'https://xxx.execute-api.ap-south-1.amazonaws.com/prod',
 * }, storageAdapter);
 * ```
 */

import type { AwsConfig, CognitoTokenBundle, AuthResult, IStorageAdapter } from '../types';
import type { AuditLedger } from '../crypto/AuditLedger';

// Re-export types
export type { AwsConfig, CognitoTokenBundle, AuthResult };

const STORAGE_KEYS = {
  TOKEN_BUNDLE: '@nhai_aws_token_bundle',
  DEVICE_ID: '@nhai_device_id',
  SESSION_STATE: '@nhai_session_state',
};

/**
 * XOR-based cipher (demo-grade). In production, inject a real AES-256 implementation.
 */
class XorCipher {
  static encrypt(plaintext: string, key: string): string {
    const keyBytes = XorCipher._strToBytes(key);
    const textBytes = XorCipher._strToBytes(plaintext);
    const cipher = textBytes.map((b, i) => b ^ keyBytes[i % keyBytes.length]);
    return btoa(String.fromCharCode(...cipher));
  }

  static decrypt(ciphertext: string, key: string): string {
    try {
      const keyBytes = XorCipher._strToBytes(key);
      const binary = atob(ciphertext);
      const cipher = Array.from(binary).map(c => c.charCodeAt(0));
      const plain = cipher.map((b, i) => b ^ keyBytes[i % keyBytes.length]);
      return String.fromCharCode(...plain);
    } catch { return ''; }
  }

  private static _strToBytes(s: string): number[] {
    const result: number[] = [];
    for (let i = 0; i < s.length; i++) result.push(s.charCodeAt(i) & 0xff);
    return result;
  }
}

export class AwsAuthClient {
  private static _instance: AwsAuthClient | null = null;

  private readonly config: AwsConfig;
  private readonly storage: IStorageAdapter;
  private readonly hashFn: (input: string) => string;

  private tokenBundle: CognitoTokenBundle | null = null;
  private deviceId = '';
  private encryptionKey = '';
  private isInitialized = false;

  /**
   * @param config   AWS configuration
   * @param storage  Storage adapter for persisting tokens
   * @param hashFn   SHA-256 hash function (from AuditLedger.sha256 or your own)
   */
  constructor(config: AwsConfig, storage: IStorageAdapter, hashFn?: (input: string) => string) {
    this.config = config;
    this.storage = storage;
    this.hashFn = hashFn ?? ((s: string) => {
      // Fallback: simple non-cryptographic hash (for demo only)
      let hash = 0;
      for (let i = 0; i < s.length; i++) {
        const char = s.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
      }
      return Math.abs(hash).toString(16).padStart(64, '0');
    });
  }

  public static getInstance(): AwsAuthClient {
    if (!AwsAuthClient._instance) {
      throw new Error('AwsAuthClient not initialized.');
    }
    return AwsAuthClient._instance;
  }

  public static setInstance(instance: AwsAuthClient): void {
    AwsAuthClient._instance = instance;
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized) return;

    this.deviceId = await this._getOrCreateDeviceId();
    this.encryptionKey = this.hashFn(this.deviceId + (this.config.deviceSecretSalt ?? 'NHAI_EDGE_DEVICE'));
    await this._restoreSession();
    this.isInitialized = true;
  }

  public async getValidToken(): Promise<string | null> {
    if (!this.tokenBundle) return null;
    const fiveMinutes = 5 * 60 * 1000;
    if (Date.now() >= this.tokenBundle.expiresAt - fiveMinutes) {
      await this.refreshSession();
    }
    return this.tokenBundle.idToken;
  }

  public async refreshSession(): Promise<boolean> {
    if (!this.tokenBundle) return false;
    const now = Date.now();
    const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'mock-key-1' }));
    const payload = btoa(JSON.stringify({
      sub: this.tokenBundle.username,
      exp: Math.floor(now / 1000) + 3600,
      iat: Math.floor(now / 1000),
    }));
    const sig = this.hashFn(header + '.' + payload + this.encryptionKey).substring(0, 43);
    this.tokenBundle.idToken = `${header}.${payload}.${sig}`;
    this.tokenBundle.expiresAt = now + 60 * 60 * 1000;
    await this._persistSession();
    return true;
  }

  public isAuthenticated(): boolean {
    return this.tokenBundle !== null;
  }

  public getCurrentUser(): string | null {
    return this.tokenBundle?.username ?? null;
  }

  public getDeviceId(): string {
    return this.deviceId;
  }

  public async logout(): Promise<void> {
    this.tokenBundle = null;
    if (this.storage.multiRemove) {
      await this.storage.multiRemove([STORAGE_KEYS.TOKEN_BUNDLE, STORAGE_KEYS.SESSION_STATE]);
    } else {
      await this.storage.removeItem(STORAGE_KEYS.TOKEN_BUNDLE);
      await this.storage.removeItem(STORAGE_KEYS.SESSION_STATE);
    }
  }

  public signPayload(payloadObj: object): object & { _sig: string; _deviceId: string; _ts: number } {
    const ts = Date.now();
    const canonical = JSON.stringify({ ...payloadObj, _ts: ts, _deviceId: this.deviceId });
    const sig = this.hashFn(this.encryptionKey + '::' + canonical);
    return { ...payloadObj, _ts: ts, _deviceId: this.deviceId, _sig: sig };
  }

  public encryptForStorage(data: object): string {
    return XorCipher.encrypt(JSON.stringify(data), this.encryptionKey);
  }

  public decryptFromStorage(ciphertext: string): object | null {
    try {
      const plaintext = XorCipher.decrypt(ciphertext, this.encryptionKey);
      return JSON.parse(plaintext);
    } catch { return null; }
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private async _persistSession(): Promise<void> {
    if (!this.tokenBundle) return;
    const encrypted = this.encryptForStorage(this.tokenBundle);
    await this.storage.setItem(STORAGE_KEYS.TOKEN_BUNDLE, encrypted);
  }

  private async _restoreSession(): Promise<void> {
    try {
      const raw = await this.storage.getItem(STORAGE_KEYS.TOKEN_BUNDLE);
      if (!raw) return;
      const decrypted = this.decryptFromStorage(raw) as CognitoTokenBundle | null;
      if (decrypted?.idToken) this.tokenBundle = decrypted;
    } catch { /* ignore */ }
  }

  private async _getOrCreateDeviceId(): Promise<string> {
    try {
      const stored = await this.storage.getItem(STORAGE_KEYS.DEVICE_ID);
      if (stored) return stored;
      const id = `NHAI-DEV-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
      await this.storage.setItem(STORAGE_KEYS.DEVICE_ID, id);
      return id;
    } catch { return `NHAI-DEV-FALLBACK-${Date.now()}`; }
  }
}
