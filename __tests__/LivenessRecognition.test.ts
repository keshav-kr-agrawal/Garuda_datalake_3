import { LivenessMathService } from '../src/services/livenessMath';
import { FaceEmbedderService } from '../src/services/faceEmbedder';
import { CryptographicLedgerService } from '../src/services/cryptographicLedger';
import { LocalDatabaseService } from '../src/services/databaseSchema';

// Mock AsyncStorage and React Native JNI modules for Jest
jest.mock('@react-native-async-storage/async-storage', () => {
  const store: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key: string) => store[key] || null),
      setItem: jest.fn(async (key: string, val: string) => {
        store[key] = val;
        return null;
      }),
      removeItem: jest.fn(async (key: string) => {
        delete store[key];
        return null;
      }),
      clear: jest.fn(async () => {
        for (const k in store) delete store[k];
        return null;
      }),
    },
  };
});

jest.mock('react-native-fast-tflite', () => ({
  loadTensorFlowModel: jest.fn(async () => ({ mock: true })),
}));

describe('NHAI Offline Facial Recognition & Liveness System Tests', () => {
  const embedder = FaceEmbedderService.getInstance();
  const liveness = LivenessMathService.getInstance();
  const ledger = CryptographicLedgerService.getInstance();
  const db = LocalDatabaseService.getInstance();

  beforeEach(async () => {
    // Reset services and ledger database mock
    liveness.reset();
    const stored = require('@react-native-async-storage/async-storage').default;
    await stored.clear();
  });

  describe('1. Face Embedding & Similarity Math', () => {
    test('L2 Normalization mathematically divides values by magnitude', () => {
      const rawVector = new Float32Array([3.0, 4.0, 0.0]); // Magnitude = 5.0
      const normalized = embedder.l2Normalize(rawVector);
      expect(normalized[0]).toBeCloseTo(0.6);
      expect(normalized[1]).toBeCloseTo(0.8);
      expect(normalized[2]).toBeCloseTo(0.0);
    });

    test('Cosine Similarity of identical normalized vectors is 1.0', () => {
      const vecA = new Float32Array([0.6, 0.8, 0.0]);
      const vecB = new Float32Array([0.6, 0.8, 0.0]);
      const sim = embedder.compareEmbeddings(vecA, vecB);
      expect(sim).toBeCloseTo(1.0, 5);
    });

    test('Cosine Similarity of orthogonal vectors is 0.0', () => {
      const vecA = new Float32Array([0.6, 0.8, 0.0]);
      const vecB = new Float32Array([0.8, -0.6, 0.0]);
      const sim = embedder.compareEmbeddings(vecA, vecB);
      expect(sim).toBeCloseTo(0.0, 5);
    });

    test('Embedding verification correctly accepts matching faces and flags mismatches', () => {
      const vecA = new Float32Array([0.6, 0.8, 0.0]);
      const vecB = new Float32Array([0.59, 0.80, 0.05]); // very similar
      const vecC = new Float32Array([0.8, -0.6, 0.0]);   // divergent

      const normB = embedder.l2Normalize(vecB);
      const normC = embedder.l2Normalize(vecC);

      expect(embedder.verifyMatch(vecA, normB).match).toBe(true);
      expect(embedder.verifyMatch(vecA, normC).match).toBe(false);
    });
  });

  describe('2. Liveness Landmark & Euler Calculations', () => {
    test('EAR correctly computes eye aspect ratios for open and closed eyelids', () => {
      const openEye = Array.from({ length: 468 }, () => ({ x: 0, y: 0, z: 0 }));
      openEye[362] = { x: 10, y: 10, z: 0 };
      openEye[385] = { x: 15, y: 15, z: 0 };
      openEye[386] = { x: 25, y: 15, z: 0 };
      openEye[263] = { x: 30, y: 10, z: 0 };
      openEye[374] = { x: 25, y: 5, z: 0 };
      openEye[380] = { x: 15, y: 5, z: 0 };

      // Mirror for right eye
      openEye[33] = { x: 50, y: 10, z: 0 };
      openEye[160] = { x: 55, y: 15, z: 0 };
      openEye[159] = { x: 65, y: 15, z: 0 };
      openEye[133] = { x: 70, y: 10, z: 0 };
      openEye[145] = { x: 65, y: 5, z: 0 };
      openEye[144] = { x: 55, y: 5, z: 0 };

      expect(liveness.calculateEAR(openEye)).toBeGreaterThan(0.25);

      const closedEye = JSON.parse(JSON.stringify(openEye));
      closedEye[385].y = 10;
      closedEye[386].y = 10;
      closedEye[380].y = 10;
      closedEye[374].y = 10;
      closedEye[160].y = 10;
      closedEye[159].y = 10;
      closedEye[144].y = 10;
      closedEye[145].y = 10;

      expect(liveness.calculateEAR(closedEye)).toBeLessThan(0.05);
    });

    test('Euler head pose correctly isolates Yaw turning angles', () => {
      const face = Array.from({ length: 468 }, () => ({ x: 0, y: 0, z: 0 }));
      face[1] = { x: 50, y: 30, z: 0 }; // Nose tip
      face[263] = { x: 65, y: 40, z: 0 }; // Left eye
      face[33] = { x: 35, y: 40, z: 0 };  // Right eye
      face[10] = { x: 50, y: 50, z: 0 };  // Forehead
      face[152] = { x: 50, y: 10, z: 0 }; // Chin

      const centerPose = liveness.estimatePose(face);
      expect(Math.abs(centerPose.yaw)).toBeLessThan(1.0);

      // Turn nose left (towards right eye visually, x shifts right)
      const turnLeft = JSON.parse(JSON.stringify(face));
      turnLeft[1].x = 58;
      const leftPose = liveness.estimatePose(turnLeft);
      expect(leftPose.yaw).toBeGreaterThan(10.0);
    });

    test('generateChallengeSequence returns a shuffled array of BLINK, SMILE, TURN_LEFT', () => {
      const sequence = liveness.generateChallengeSequence();
      expect(sequence.length).toBe(3);
      expect(sequence).toContain('BLINK');
      expect(sequence).toContain('SMILE');
      expect(sequence).toContain('TURN_LEFT');
    });
  });

  describe('3. Cryptographic Ledger Chain Integrity', () => {
    test('Genesis block correctly initializes and links transactions in sequential chains', async () => {
      const block1 = await ledger.recordTransaction('NHAI-2026-001', 28.6139, 77.2090, 0.98, 'VERIFIED');
      expect(block1).not.toBeNull();
      expect(block1!.prevHash).toBe('GENESIS_BLOCK_NHAI_7.0_KEY_CORRIDOR');

      const block2 = await ledger.recordTransaction('NHAI-2026-002', 28.6139, 77.2090, 0.99, 'VERIFIED');
      expect(block2).not.toBeNull();
      expect(block2!.prevHash).toBe(block1!.hash);

      const check = await ledger.verifyLedgerIntegrity();
      expect(check.valid).toBe(true);
    });

    test('Self-test security scanner correctly catches and rejects database modifications', async () => {
      const block1 = await ledger.recordTransaction('NHAI-2026-001', 28.6139, 77.2090, 0.98, 'VERIFIED');
      await ledger.recordTransaction('NHAI-2026-002', 28.6139, 77.2090, 0.99, 'VERIFIED');

      // Hacker alters historical ledger records
      const current = await db.getLedger();
      current[0].userId = 'MALICIOUS_HACKER_ATTACK_SPOOF';
      await db.saveLedger(current);

      const check = await ledger.verifyLedgerIntegrity();
      expect(check.valid).toBe(false);
      expect(check.errorIndex).toBe(0); // Caught at block 0!
    });
  });

  describe('4. 10,000 Vector Database Seeding & Search Performance Benchmarking', () => {
    test('Seeding and performing vector dot-product lookup over 10,000 users completes in under 30ms', async () => {
      // 1. Bulk seed 10,000 vectors
      await db.seed10kDatabase();
      const users = await db.getEnrolledUsers();
      expect(users.length).toBe(10000);

      // 2. Setup mock target face query vector (identical to Keshav's embedding)
      const query = new Float32Array(Array.from({ length: 128 }, (_, i) => Math.sin(i) * Math.cos(i * 1.5)));
      
      // Perform L2-normalization on the query
      let sumSq = 0;
      for (let i = 0; i < 128; i++) sumSq += query[i] * query[i];
      const mag = Math.sqrt(sumSq);
      for (let i = 0; i < 128; i++) query[i] = mag === 0 ? 0 : query[i] / mag;

      // 3. Measure vectorSearch execution latency
      const start = Date.now();
      const result = await db.vectorSearch(query);
      const latency = Date.now() - start;

      console.log(`[Performance Benchmark] Vector search over 10,000 profiles completed in: ${latency}ms`);

      // 4. Assert correctness
      expect(result.user).not.toBeNull();
      expect(result.user!.id).toBe('NHAI-2026-001'); // Correctly matched Keshav Kumar Agrawal
      expect(result.similarity).toBeCloseTo(1.0, 4);  // Cosine match is 1.0 (perfect identical)

      // 5. Assert latency under the strict 30ms requirement
      expect(latency).toBeLessThan(30);
    });
  });
});
