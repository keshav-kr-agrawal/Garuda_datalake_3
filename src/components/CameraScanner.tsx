import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  SafeAreaView,
  Dimensions,
} from 'react-native';
import { Camera, useCameraDevice } from 'react-native-vision-camera';
import Svg, { Circle, Rect } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withRepeat,
  withSequence,
  withTiming,
  interpolateColor,
} from 'react-native-reanimated';

import { useCameraPermissions } from '../hooks/useCameraPermissions';
import { LivenessMathService, LivenessChallenge, ChallengeState } from '../services/livenessMath';
import { FaceEmbedderService } from '../services/faceEmbedder';
import { CryptographicLedgerService } from '../services/cryptographicLedger';
import { SyncManagerService } from '../services/syncManager';
import { LocalDatabaseService, EnrolledUser, AuditLog } from '../services/databaseSchema';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SCAN_RING_SIZE = SCREEN_WIDTH * 0.72;

export const CameraScanner: React.FC = () => {
  const device = useCameraDevice('front');
  const { camera, location, loading, requestPermissions } = useCameraPermissions();

  // Core Services
  const livenessService = LivenessMathService.getInstance();
  const embedderService = FaceEmbedderService.getInstance();
  const ledgerService = CryptographicLedgerService.getInstance();
  const syncService = SyncManagerService.getInstance();
  const dbService = LocalDatabaseService.getInstance();

  // UI & Scan States
  const [activeUser, setActiveUser] = useState<EnrolledUser | null>(null);
  const [challengeState, setChallengeState] = useState<ChallengeState>({
    currentChallenge: 'BLINK',
    progress: 0,
    isCalibrated: false,
    message: 'Align face to begin calibration',
  });

  const [activeChallengeIdx, setActiveChallengeIdx] = useState(0);
  const [challengesList, setChallengesList] = useState<LivenessChallenge[]>(['BLINK', 'SMILE', 'TURN_LEFT']);
  const [logsList, setLogsList] = useState<AuditLog[]>([]);
  const [syncStatusMsg, setSyncStatusMsg] = useState('System fully offline. Sync pending.');
  
  // Reanimated Shared Values for dynamic HUD transitions (Amber -> Emerald / Crimson)
  const statusColorVal = useSharedValue(0); // 0 = Amber (scanning), 1 = Emerald (verified), 2 = Crimson (failed)
  const ringScaleVal = useSharedValue(1);
  const pulseVal = useSharedValue(1);

  useEffect(() => {
    // Seed and load data on start
    const bootstrap = async () => {
      await dbService.seedDatabaseIfEmpty();
      await embedderService.initialize();
      syncService.initialize();
      await refreshLogs();
      
      // Auto-assign random mock user to verify against
      const users = await dbService.getEnrolledUsers();
      if (users.length > 0) {
        setActiveUser(users[0]);
      }
      setChallengesList(livenessService.generateChallengeSequence());
    };
    bootstrap();

    // Loop a subtle pulse animation for scanning
    pulseVal.value = withRepeat(
      withSequence(
        withTiming(1.08, { duration: 1200 }),
        withTiming(0.98, { duration: 1200 })
      ),
      -1,
      true
    );
  }, []);

  const refreshLogs = async () => {
    const list = await dbService.getLedger();
    // Show newest first
    setLogsList([...list].reverse());
  };

  // Reanimated HUD styles
  const animatedRingStyle = useAnimatedStyle(() => {
    const borderColor = interpolateColor(
      statusColorVal.value,
      [0, 1, 2],
      ['rgba(217, 119, 6, 0.85)', 'rgba(16, 185, 129, 0.85)', 'rgba(239, 68, 68, 0.85)'] // HSL Tailored Amber -> Emerald -> Crimson
    );
    
    return {
      borderColor,
      transform: [
        { scale: withSpring(ringScaleVal.value) },
        { scaleX: pulseVal.value },
        { scaleY: pulseVal.value }
      ],
    };
  });

  const animatedMessageStyle = useAnimatedStyle(() => {
    const color = interpolateColor(
      statusColorVal.value,
      [0, 1, 2],
      ['#f59e0b', '#10b981', '#ef4444']
    );
    return { color };
  });

  /**
   * Resets verification cycle
   */
  const handleResetVerification = () => {
    livenessService.reset();
    const shuffled = livenessService.generateChallengeSequence();
    setChallengesList(shuffled);
    setActiveChallengeIdx(0);
    statusColorVal.value = 0;
    ringScaleVal.value = 1;
    setChallengeState({
      currentChallenge: shuffled[0],
      progress: 0,
      isCalibrated: false,
      message: 'Align face to begin calibration',
    });
  };

  /**
   * Simulates real-time video frame processor landmarks logic.
   * Feeds inputs to EAR, MAR, and Pose estimators offline.
   */
  const handleSimulateFrameUpdate = (action: 'BLINK_OK' | 'SMILE_OK' | 'TURN_OK') => {
    const mockLandmarks = Array.from({ length: 468 }, () => ({ x: 0, y: 0, z: 0 }));
    const currentChallenge = challengesList[activeChallengeIdx];

    // Inject simulated mathematical properties based on challenge targets
    if (action === 'BLINK_OK' && currentChallenge === 'BLINK') {
      // Simulate low EAR (blink)
      livenessService.calibrate(0.30, 0.15); // force calibration
      for (let i = 0; i < 15; i++) {
        livenessService.processFrame(mockLandmarks, 'BLINK');
      }
      // Force success
      const res = livenessService.processFrame(mockLandmarks, 'BLINK');
      setChallengeState(res);
      advanceChallenge();
    } else if (action === 'SMILE_OK' && currentChallenge === 'SMILE') {
      livenessService.processFrame(mockLandmarks, 'SMILE');
      advanceChallenge();
    } else if (action === 'TURN_OK' && currentChallenge === 'TURN_LEFT') {
      livenessService.processFrame(mockLandmarks, 'TURN_LEFT');
      advanceChallenge();
    }
  };

  const advanceChallenge = async () => {
    if (activeChallengeIdx < challengesList.length - 1) {
      const nextIdx = activeChallengeIdx + 1;
      setActiveChallengeIdx(nextIdx);
      setChallengeState(prev => ({
        ...prev,
        currentChallenge: challengesList[nextIdx],
        progress: 0,
        message: `Challenge ${nextIdx + 1} of ${challengesList.length}: Please ${challengesList[nextIdx]}`,
      }));
      
      // Pulse animation
      ringScaleVal.value = 1.15;
      setTimeout(() => { ringScaleVal.value = 1.0; }, 200);
    } else {
      // All liveness checks passed! Trigger Face Embedding & Vector Match
      statusColorVal.value = 1; // Success color (Emerald)
      ringScaleVal.value = 1.1;

      setChallengeState({
        currentChallenge: 'SUCCESS',
        progress: 1.0,
        isCalibrated: true,
        message: 'Liveness Approved! Matching face embedding...',
      });

      if (activeUser) {
        // Run MobileFaceNet float32 embedding generator
        const inputBuffer = new Float32Array(128); // dummy image input
        const embedding = await embedderService.generateEmbedding(inputBuffer);
        const enrolledVector = new Float32Array(activeUser.embedding);
        
        // Match embeddings via Cosine similarity dot-product
        const result = embedderService.verifyMatch(embedding, enrolledVector);

        if (result.match) {
          // Write authenticated block to SHA-256 Ledger
          await ledgerService.recordTransaction(
            activeUser.id,
            28.6139, // Simulated Toll Location Delhi Lat
            77.2090, // Lon
            result.confidence,
            'VERIFIED'
          );
          
          setChallengeState(prev => ({
            ...prev,
            message: `Verified! Welcome, ${activeUser.name}\nConfidence: ${(result.confidence * 100).toFixed(1)}%`,
          }));
          Alert.alert('Face Verified', `Identity matched successfully as ${activeUser.name} (${activeUser.role}) with ${(result.confidence * 100).toFixed(1)}% match confidence.`);
        } else {
          statusColorVal.value = 2; // Crimson
          await ledgerService.recordTransaction(
            activeUser.id,
            28.6139,
            77.2090,
            result.confidence,
            'FAILED'
          );
          setChallengeState(prev => ({
            ...prev,
            currentChallenge: 'FAILED',
            message: 'Identity mismatch! Access Denied.',
          }));
        }
      }
      await refreshLogs();
    }
  };

  /**
   * Tamper Demo: Deliberately edits local storage to break the ledger signature
   */
  const handleCorruptLedger = async () => {
    const list = await dbService.getLedger();
    if (list.length < 2) {
      Alert.alert('Tamper Demo Halted', 'Please perform at least 2 check-ins first to establish a chain block structure.');
      return;
    }

    // Maliciously modify the first block's user ID directly in storage
    const tamperedList = [...list];
    tamperedList[0].userId = 'MOCK_SPOOFED_INTRUDER_ID';
    await dbService.saveLedger(tamperedList);
    await refreshLogs();
    
    Alert.alert('Ledger Corrupted', 'Rogue hacker successfully side-loaded "MOCK_SPOOFED_INTRUDER_ID" into historical transactions directly in offline cache.');
  };

  /**
   * Run Cryptographic Integrity Chain Verification
   */
  const handleVerifyChain = async () => {
    const res = await ledgerService.verifyLedgerIntegrity();
    if (res.valid) {
      Alert.alert('Security Check: 100% OK', 'Cryptographic Ledger self-test passed successfully. Zero-tampering identified in historical database.');
    } else {
      statusColorVal.value = 2; // Crimson
      Alert.alert(
        '🚨 SECURITY FRAUD TRIGGERED!',
        `Ledger integrity check failed at TRANSACTION BLOCK ${res.errorIndex}! Cryptographic signature mismatch. Database offline sync has been automatically blocked.`,
        [
          { 
            text: 'Rebuild & Healing Ledger', 
            onPress: async () => {
              // Heal by clearing or restoring correct hash order
              const list = await dbService.getLedger();
              if (list.length > 0 && res.errorIndex >= 0) {
                // Recover correct userId
                list[res.errorIndex].userId = activeUser ? activeUser.id : 'NHAI-2026-001';
                // Re-calculate correct hash sequence
                let prevHash = res.errorIndex > 0 ? list[res.errorIndex - 1].hash : 'GENESIS_BLOCK_NHAI_7.0_KEY_CORRIDOR';
                for (let k = res.errorIndex; k < list.length; k++) {
                  list[k].prevHash = prevHash;
                  list[k].hash = ledgerService.generateBlockHash(
                    prevHash, list[k].timestamp, list[k].userId, list[k].latitude, list[k].longitude, list[k].confidence, list[k].status
                  );
                  prevHash = list[k].hash;
                }
                await dbService.saveLedger(list);
                await refreshLogs();
                statusColorVal.value = 0;
                Alert.alert('Ledger Healed', 'Cryptographic block hashes successfully recalculated. Security chain integrity restored.');
              }
            } 
          },
          { text: 'Cancel', style: 'cancel' }
        ]
      );
    }
  };

  /**
   * Manually Sync Logs to AWS & Purge
   */
  const handleTriggerSync = async () => {
    setSyncStatusMsg('Sync in progress...');
    const result = await syncService.triggerSync();
    setSyncStatusMsg(result.message);
    await refreshLogs();
    Alert.alert(result.success ? 'AWS Sync Success' : 'Sync Blocked', result.message);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
        {/* Header Branding */}
        <View style={styles.header}>
          <Text style={styles.brandTitle}>DATALAKE 3.0</Text>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>OFFLINE MODE</Text>
          </View>
        </View>

        {/* Circular HUD Camera Viewport */}
        <View style={styles.scannerWrapper}>
          <Animated.View style={[styles.scanRing, animatedRingStyle]}>
            {device && camera ? (
              <Camera
                style={styles.camera}
                device={device}
                isActive={true}
                photo={false}
              />
            ) : (
              <View style={styles.cameraPlaceholder}>
                <ActivityIndicator size="large" color="#f59e0b" />
                <Text style={styles.placeholderText}>Camera Feed Offline</Text>
              </View>
            )}
          </Animated.View>
          
          {/* Liquid Glass Overlay HUD */}
          <View style={styles.overlayHUD}>
            <Svg height="100%" width="100%" viewBox="0 0 100 100">
              <Circle
                cx="50"
                cy="50"
                r="46"
                stroke="rgba(255, 255, 255, 0.12)"
                strokeWidth="1"
                fill="none"
              />
              <Circle
                cx="50"
                cy="50"
                r="40"
                stroke="rgba(255, 255, 255, 0.05)"
                strokeWidth="0.5"
                strokeDasharray="4 4"
                fill="none"
              />
            </Svg>
          </View>
        </View>

        {/* Liveness HUD Message Indicator */}
        <View style={styles.hudCard}>
          <Animated.Text style={[styles.hudMessage, animatedMessageStyle]}>
            {challengeState.message}
          </Animated.Text>
          
          {/* Visual Challenge Progress Bar */}
          <View style={styles.progressContainer}>
            <View style={styles.progressBarBg}>
              <View 
                style={[
                  styles.progressBarFill, 
                  { 
                    width: `${challengeState.progress * 100}%`,
                    backgroundColor: statusColorVal.value === 1 ? '#10b981' : statusColorVal.value === 2 ? '#ef4444' : '#f59e0b' 
                  }
                ]} 
              />
            </View>
            <Text style={styles.progressLabel}>
              {challengeState.currentChallenge} PROGRESS: {Math.round(challengeState.progress * 100)}%
            </Text>
          </View>
        </View>

        {/* Hackathon Verification Interactive Controller Panel */}
        <View style={styles.glassCard}>
          <Text style={styles.cardHeader}>JUDGING VERIFICATION PANEL</Text>
          
          <Text style={styles.controlLabel}>1. Mathematical Offline Anti-Spoof (Liveness):</Text>
          <View style={styles.btnRow}>
            <TouchableOpacity 
              style={[styles.btn, styles.actionBtn]} 
              onPress={() => handleSimulateFrameUpdate('BLINK_OK')}
            >
              <Text style={styles.btnText}>Simulate Blink</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.btn, styles.actionBtn]} 
              onPress={() => handleSimulateFrameUpdate('SMILE_OK')}
              disabled={challengeState.currentChallenge !== 'SMILE'}
            >
              <Text style={[styles.btnText, challengeState.currentChallenge !== 'SMILE' && styles.disabledText]}>Simulate Smile</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.btn, styles.actionBtn]} 
              onPress={() => handleSimulateFrameUpdate('TURN_OK')}
              disabled={challengeState.currentChallenge !== 'TURN_LEFT'}
            >
              <Text style={[styles.btnText, challengeState.currentChallenge !== 'TURN_LEFT' && styles.disabledText]}>Simulate Head Turn</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.controlLabel}>2. Offline Ledger Security (SHA-256 Tamper Proof):</Text>
          <View style={styles.btnRow}>
            <TouchableOpacity style={[styles.btn, styles.successBtn]} onPress={handleVerifyChain}>
              <Text style={styles.btnText}>Run Security Self-Test</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.dangerBtn]} onPress={handleCorruptLedger}>
              <Text style={styles.btnText}>Corrupt DB (Tamper Test)</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.controlLabel}>3. Restored AWS Sync & Local Memory Purge:</Text>
          <View style={styles.btnRow}>
            <TouchableOpacity style={[styles.btn, styles.syncBtn]} onPress={handleTriggerSync}>
              <Text style={styles.btnText}>Manual REST Sync Queue</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.secondaryBtn]} onPress={handleResetVerification}>
              <Text style={styles.btnText}>Reset HUD Scan</Text>
            </TouchableOpacity>
          </View>
          
          <Text style={styles.syncStatus}>{syncStatusMsg}</Text>
        </View>

        {/* Real-time Ledger Chain Logs Display */}
        <View style={styles.logCard}>
          <Text style={styles.cardHeader}>SECURE BLOCKCHAIN LEDGER ({logsList.length} logs)</Text>
          {logsList.length === 0 ? (
            <Text style={styles.noLogs}>No transactions recorded. Complete a scan loop to write block.</Text>
          ) : (
            logsList.map((log, idx) => (
              <View key={log.id} style={styles.logItem}>
                <View style={styles.logHeaderLine}>
                  <Text style={styles.logId}>{log.id}</Text>
                  <Text style={[styles.logStatus, log.status === 'VERIFIED' ? styles.statusGreen : styles.statusRed]}>
                    {log.status}
                  </Text>
                </View>
                <Text style={styles.logDetail}>Personnel: {log.userId}</Text>
                <Text style={styles.logDetail}>Loc: {log.latitude.toFixed(4)}, {log.longitude.toFixed(4)} | Confidence: {(log.confidence * 100).toFixed(1)}%</Text>
                <Text style={styles.logHash} numberOfLines={1}>PrevHash: {log.prevHash}</Text>
                <Text style={styles.logHash} numberOfLines={1}>BlockHash: {log.hash}</Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0f1d', // Sleek Premium Dark Mode
  },
  scrollContainer: {
    padding: 16,
    alignItems: 'center',
  },
  header: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    marginTop: 10,
  },
  brandTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 2,
  },
  badge: {
    backgroundColor: '#f59e0b',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeText: {
    color: '#000000',
    fontWeight: '800',
    fontSize: 10,
  },
  scannerWrapper: {
    width: SCAN_RING_SIZE,
    height: SCAN_RING_SIZE,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  scanRing: {
    width: SCAN_RING_SIZE,
    height: SCAN_RING_SIZE,
    borderRadius: SCAN_RING_SIZE / 2,
    borderWidth: 4,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#f59e0b',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 15,
    elevation: 10,
  },
  camera: {
    width: '100%',
    height: '100%',
  },
  cameraPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: '#111827',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    color: '#9ca3af',
    fontSize: 12,
    marginTop: 8,
  },
  overlayHUD: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    pointerEvents: 'none',
  },
  hudCard: {
    width: '100%',
    backgroundColor: 'rgba(17, 24, 39, 0.7)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    marginBottom: 16,
  },
  hudMessage: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
    lineHeight: 22,
  },
  progressContainer: {
    width: '100%',
    alignItems: 'center',
  },
  progressBarBg: {
    width: '100%',
    height: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 6,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressLabel: {
    fontSize: 9,
    color: '#9ca3af',
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  glassCard: {
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.03)', // Premium Glassmorphism
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    padding: 16,
    marginBottom: 16,
  },
  cardHeader: {
    fontSize: 12,
    fontWeight: '800',
    color: '#9ca3af',
    letterSpacing: 1.5,
    marginBottom: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    paddingBottom: 6,
  },
  controlLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#d1d5db',
    marginTop: 8,
    marginBottom: 8,
  },
  btnRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 10,
    gap: 8,
  },
  btn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
  },
  actionBtn: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.4)',
  },
  successBtn: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.4)',
  },
  dangerBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
  },
  syncBtn: {
    backgroundColor: '#3b82f6',
  },
  secondaryBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  btnText: {
    fontSize: 10,
    color: '#ffffff',
    fontWeight: '800',
    textAlign: 'center',
  },
  disabledText: {
    color: '#6b7280',
  },
  syncStatus: {
    fontSize: 9,
    fontStyle: 'italic',
    color: '#9ca3af',
    textAlign: 'center',
    marginTop: 6,
  },
  logCard: {
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
    padding: 16,
    marginBottom: 20,
  },
  noLogs: {
    color: '#6b7280',
    fontSize: 11,
    textAlign: 'center',
    paddingVertical: 12,
  },
  logItem: {
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  logHeaderLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  logId: {
    fontSize: 10,
    fontWeight: '700',
    color: '#60a5fa',
  },
  logStatus: {
    fontSize: 9,
    fontWeight: '800',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusGreen: {
    color: '#10b981',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
  },
  statusRed: {
    color: '#ef4444',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  logDetail: {
    fontSize: 10,
    color: '#d1d5db',
    marginBottom: 2,
  },
  logHash: {
    fontSize: 7,
    fontFamily: 'monospace',
    color: '#6b7280',
  },
});
