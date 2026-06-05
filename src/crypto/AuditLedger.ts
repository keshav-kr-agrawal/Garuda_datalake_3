/**
 * AuditLedger — SHA-256 hash-chained cryptographic audit trail.
 *
 * Records biometric verification transactions in a blockchain-style ledger
 * where each block's hash includes the previous block's hash, making
 * retroactive tampering detectable via the self-test verifier.
 *
 * Features:
 * - Pure-JS SHA-256 implementation (zero native dependencies)
 * - Genesis block initialization
 * - Sequential hash chain linking
 * - Self-test integrity verification
 *
 * @example
 * ```ts
 * import { AuditLedger, LocalDatabase } from 'nhai-garuda';
 *
 * const db = new LocalDatabase(storageAdapter);
 * const ledger = new AuditLedger(db);
 *
 * await ledger.recordTransaction('NHAI-001', 28.6139, 77.2090, 0.98, 'VERIFIED');
 * const { valid } = await ledger.verifyLedgerIntegrity();
 * ```
 */

import type { AuditLog } from '../types';

/** Interface for the database operations the ledger needs */
export interface LedgerStorage {
  getLedger(): Promise<AuditLog[]>;
  appendLedgerBlock(block: AuditLog): Promise<boolean>;
  saveLedger(ledger: AuditLog[]): Promise<boolean>;
}

export class AuditLedger {
  private static _instance: AuditLedger | null = null;

  private readonly storage: LedgerStorage;

  constructor(storage: LedgerStorage) {
    this.storage = storage;
  }

  /** Backward-compatible singleton (requires prior setup). */
  public static getInstance(): AuditLedger {
    if (!AuditLedger._instance) {
      throw new Error('AuditLedger not initialized. Call new AuditLedger(storage) first.');
    }
    return AuditLedger._instance;
  }

  /** Set the singleton instance (for backward compatibility). */
  public static setInstance(instance: AuditLedger): void {
    AuditLedger._instance = instance;
  }

  public static resetInstance(): void {
    AuditLedger._instance = null;
  }

  /**
   * Pure-JS SHA-256 implementation.
   * Zero dependencies — works in any JavaScript environment.
   */
  public sha256(ascii: string): string {
    function rightRotate(value: number, amount: number) {
      return (value >>> amount) | (value << (32 - amount));
    }

    const mathPow = Math.pow;
    const maxWord = mathPow(2, 32);
    let result = '';

    const words: number[] = [];
    const asciiLength = ascii.length;

    const hash = [
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ];

    const k = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];

    let i: number;
    let j: number;

    const isAlpha = ascii + '\x80';
    let isAlphaLength = isAlpha.length;
    while (isAlphaLength % 64 - 56) {
      ascii += '\x00';
      isAlphaLength = (ascii + '\x80').length;
    }

    ascii += '\x80';
    for (i = 0; i < ascii.length - 8; i++) {
      words[i >> 2] |= (ascii.charCodeAt(i) & 0xff) << (24 - (i % 4) * 8);
    }

    words[words.length] = ((asciiLength - 1) * 8) / maxWord;
    words[words.length] = ((asciiLength - 1) * 8);

    const wordsLength = words.length;

    for (i = 0; i < wordsLength; i += 16) {
      const w: number[] = [];
      for (j = 0; j < 16; j++) {
        w[j] = words[i + j];
      }
      for (j = 16; j < 64; j++) {
        const s0 = rightRotate(w[j - 15], 7) ^ rightRotate(w[j - 15], 18) ^ (w[j - 15] >>> 3);
        const s1 = rightRotate(w[j - 2], 17) ^ rightRotate(w[j - 2], 19) ^ (w[j - 2] >>> 10);
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
      }

      let a = hash[0], b = hash[1], c = hash[2], d = hash[3];
      let e = hash[4], f = hash[5], g = hash[6], h = hash[7];

      for (j = 0; j < 64; j++) {
        const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
        const ch = (e & f) ^ (~e & g);
        const temp1 = (h + S1 + ch + k[j] + w[j]) | 0;
        const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (S0 + maj) | 0;

        h = g; g = f; f = e;
        e = (d + temp1) | 0;
        d = c; c = b; b = a;
        a = (temp1 + temp2) | 0;
      }

      hash[0] = (hash[0] + a) | 0;
      hash[1] = (hash[1] + b) | 0;
      hash[2] = (hash[2] + c) | 0;
      hash[3] = (hash[3] + d) | 0;
      hash[4] = (hash[4] + e) | 0;
      hash[5] = (hash[5] + f) | 0;
      hash[6] = (hash[6] + g) | 0;
      hash[7] = (hash[7] + h) | 0;
    }

    for (i = 0; i < 8; i++) {
      for (j = 24; j >= 0; j -= 8) {
        const byte = (hash[i] >> j) & 0xff;
        result += (byte < 16 ? '0' : '') + byte.toString(16);
      }
    }

    return result;
  }

  /** Generate a block hash from transaction attributes + previous hash. */
  public generateBlockHash(
    prevHash: string,
    timestamp: number,
    userId: string,
    latitude: number,
    longitude: number,
    confidence: number,
    status: string
  ): string {
    const payload = `${prevHash}|${timestamp}|${userId}|${latitude.toFixed(6)}|${longitude.toFixed(6)}|${confidence.toFixed(4)}|${status}`;
    return this.sha256(payload);
  }

  /** Record a new verified transaction to the ledger. */
  public async recordTransaction(
    userId: string,
    latitude: number,
    longitude: number,
    confidence: number,
    status: 'VERIFIED' | 'SPOOF_DETECTED' | 'FAILED'
  ): Promise<AuditLog | null> {
    try {
      const ledger = await this.storage.getLedger();

      const prevHash = ledger.length > 0
        ? ledger[ledger.length - 1].hash
        : 'GENESIS_BLOCK_NHAI_7.0_KEY_CORRIDOR';

      const timestamp = Date.now();
      const id = `TX-${timestamp}-${Math.floor(Math.random() * 1000)}`;

      const hash = this.generateBlockHash(prevHash, timestamp, userId, latitude, longitude, confidence, status);

      const newBlock: AuditLog = {
        id, timestamp, userId, latitude, longitude, confidence, status, prevHash, hash
      };

      const success = await this.storage.appendLedgerBlock(newBlock);
      return success ? newBlock : null;
    } catch {
      return null;
    }
  }

  /**
   * Self-test: traverses the entire blockchain and verifies hash chain integrity.
   * Returns { valid: true } if untampered, or the index of the first corrupted block.
   */
  public async verifyLedgerIntegrity(): Promise<{ valid: boolean; errorIndex: number }> {
    try {
      const ledger = await this.storage.getLedger();
      if (ledger.length === 0) return { valid: true, errorIndex: -1 };

      let expectedPrevHash = 'GENESIS_BLOCK_NHAI_7.0_KEY_CORRIDOR';

      for (let i = 0; i < ledger.length; i++) {
        const block = ledger[i];

        if (block.prevHash !== expectedPrevHash) {
          return { valid: false, errorIndex: i };
        }

        const computedHash = this.generateBlockHash(
          block.prevHash, block.timestamp, block.userId,
          block.latitude, block.longitude, block.confidence, block.status
        );

        if (block.hash !== computedHash) {
          return { valid: false, errorIndex: i };
        }

        expectedPrevHash = block.hash;
      }

      return { valid: true, errorIndex: -1 };
    } catch {
      return { valid: false, errorIndex: -2 };
    }
  }
}
