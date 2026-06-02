import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
  Alert,
  ScrollView,
  SafeAreaView,
  Dimensions,
  Platform,
  TouchableWithoutFeedback,
} from 'react-native';
import { Camera, useCameraDevice } from 'react-native-vision-camera';
import Svg, { Circle, Path, Line } from 'react-native-svg';
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
const SCAN_RING_SIZE = SCREEN_WIDTH * 0.68;

// Custom Inline SVG Icons for Premium Interface
const ScanIcon = ({ color }: { color: string }) => (
  <Svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <Path d="M9 3H5a2 2 0 00-2 2v4m16-6h-4a2 2 0 00-2 2v0m6 6v-4a2 2 0 00-2-2m-8 16H5a2 2 0 01-2-2v-4m16 6h-4a2 2 0 01-2-2m-3-6a3 3 0 11-6 0 3 3 0 016 0z" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const LogsIcon = ({ color }: { color: string }) => (
  <Svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <Path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 00-2 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9h4m-4 4h6" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const ShieldIcon = ({ color }: { color: string }) => (
  <Svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <Path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const CheckIcon = ({ color }: { color: string }) => (
  <Svg width="12" height="12" viewBox="0 0 24 24" fill="none">
    <Path d="M20 6L9 17l-5-5" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const LockIcon = ({ color }: { color: string }) => (
  <Svg width="11" height="11" viewBox="0 0 24 24" fill="none">
    <Rect x="3" y="11" width="18" height="11" rx="2" ry="2" stroke={color} strokeWidth="2" />
    <Path d="M7 11V7a5 5 0 0110 0v4" stroke={color} strokeWidth="2" />
  </Svg>
);

// High-fidelity spring scaling press interaction wrapper
const ScalePress: React.FC<{
  onPress: () => void;
  disabled?: boolean;
  style?: any;
  children: React.ReactNode;
}> = ({ onPress, disabled, style, children }) => {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    if (disabled) return;
    scale.value = withTiming(0.96, { duration: 90 });
  };

  const handlePressOut = () => {
    if (disabled) return;
    scale.value = withSpring(1, { damping: 11, stiffness: 220 });
  };

  return (
    <TouchableWithoutFeedback
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={disabled ? undefined : onPress}
    >
      <Animated.View style={[animatedStyle, style]}>
        {children}
      </Animated.View>
    </TouchableWithoutFeedback>
  );
};

export const CameraScanner: React.FC = () => {
  const device = useCameraDevice('front');
  const { camera, location, loading, requestPermissions } = useCameraPermissions();

  const [activeTab, setActiveTab] = useState<'scan' | 'logs' | 'security'>('scan');

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
    message: 'Align face within HUD bounds to start calibration',
  });

  const [activeChallengeIdx, setActiveChallengeIdx] = useState(0);
  const [challengesList, setChallengesList] = useState<LivenessChallenge[]>(['BLINK', 'SMILE', 'TURN_LEFT']);
  const [logsList, setLogsList] = useState<AuditLog[]>([]);
  const [syncStatusMsg, setSyncStatusMsg] = useState('Off-grid mode active. Sync pending.');
  
  // Real-time ticking telemetry statistics
  const [liveStats, setLiveStats] = useState({
    ear: 0.320,
    mar: 0.140,
    yaw: 0.0,
    pitch: 0.0,
    fps: 30,
  });

  // Reanimated Shared Values
  const statusColorVal = useSharedValue(0); // 0 = Amber (scanning), 1 = Emerald (verified), 2 = Crimson (failed)
  const ringScaleVal = useSharedValue(1);
  const pulseVal = useSharedValue(1);
  const scanLineY = useSharedValue(-SCAN_RING_SIZE / 2);
  const progressAnim = useSharedValue(0);

  useEffect(() => {
    // Bootstrap datasets
    const bootstrap = async () => {
      await dbService.seedDatabaseIfEmpty();
      await embedderService.initialize();
      syncService.initialize();
      await refreshLogs();
      
      const users = await dbService.getEnrolledUsers();
      if (users.length > 0) {
        setActiveUser(users[0]);
      }
      setChallengesList(livenessService.generateChallengeSequence());
    };
    bootstrap();

    // Pulse animation (smooth breath rhythm)
    pulseVal.value = withRepeat(
      withSequence(
        withTiming(1.02, { duration: 1500 }),
        withTiming(0.98, { duration: 1500 })
      ),
      -1,
      true
    );

    // Laser scanning line translation loop
    scanLineY.value = withRepeat(
      withSequence(
        withTiming(SCAN_RING_SIZE / 2 - 4, { duration: 2200 }),
        withTiming(-SCAN_RING_SIZE / 2 + 4, { duration: 2200 })
      ),
      -1,
      true
    );
  }, []);

  // Fluctuating biometric tracking telemetry simulator
  useEffect(() => {
    if (challengeState.currentChallenge === 'SUCCESS' || challengeState.currentChallenge === 'FAILED') {
      return;
    }
    const interval = setInterval(() => {
      setLiveStats(prev => {
        let targetEar = 0.315 + (Math.random() - 0.5) * 0.02;
        let targetMar = 0.135 + (Math.random() - 0.5) * 0.015;
        let targetYaw = (Math.random() - 0.5) * 2;
        let targetPitch = (Math.random() - 0.5) * 1.5;

        const current = challengesList[activeChallengeIdx];
        if (!challengeState.isCalibrated) {
          // Normal open baseline
        } else if (current === 'BLINK' && challengeState.progress > 0) {
          targetEar = 0.102 + Math.random() * 0.03; // Closed eye simulation
        } else if (current === 'SMILE' && challengeState.progress > 0) {
          targetMar = 0.265 + (Math.random() - 0.5) * 0.02; // Smile stretch simulation
        } else if (current === 'TURN_LEFT' && challengeState.progress > 0) {
          targetYaw = 17.8 + (Math.random() - 0.5) * 1.5; // Yaw rotation simulation
        }

        return {
          ear: Number(targetEar.toFixed(3)),
          mar: Number(targetMar.toFixed(3)),
          yaw: Number(targetYaw.toFixed(1)),
          pitch: Number(targetPitch.toFixed(1)),
          fps: Math.floor(29 + Math.random() * 2),
        };
      });
    }, 200);

    return () => clearInterval(interval);
  }, [activeChallengeIdx, challengeState.currentChallenge, challengeState.isCalibrated, challengeState.progress]);

  // Update animated progress bar when liveness state shifts
  useEffect(() => {
    progressAnim.value = withSpring(challengeState.progress, { damping: 15, stiffness: 90 });
  }, [challengeState.progress]);

  const refreshLogs = async () => {
    const list = await dbService.getLedger();
    setLogsList([...list].reverse());
  };

  // Reanimated HUD Styles
  const animatedRingStyle = useAnimatedStyle(() => {
    const borderColor = interpolateColor(
      statusColorVal.value,
      [0, 1, 2],
      ['#ff9f1c', '#10b981', '#f43f5e'] // Saffron/Amber -> Emerald -> Rose
    );
    
    return {
      borderColor,
      transform: [
        { scale: withSpring(ringScaleVal.value) },
        { scaleX: pulseVal.value },
        { scaleY: pulseVal.value }
      ],
      shadowColor: borderColor,
    };
  });

  const animatedMessageStyle = useAnimatedStyle(() => {
    const color = interpolateColor(
      statusColorVal.value,
      [0, 1, 2],
      ['#ff9f1c', '#10b981', '#f43f5e']
    );
    return { color };
  });

  const animatedScanLineStyle = useAnimatedStyle(() => {
    const backgroundColor = interpolateColor(
      statusColorVal.value,
      [0, 1, 2],
      ['rgba(255, 159, 28, 0.65)', 'rgba(16, 185, 129, 0.65)', 'rgba(244, 63, 94, 0.65)']
    );
    const shadowColor = interpolateColor(
      statusColorVal.value,
      [0, 1, 2],
      ['#ff9f1c', '#10b981', '#f43f5e']
    );

    return {
      transform: [{ translateY: scanLineY.value }],
      backgroundColor,
      shadowColor,
    };
  });

  const animatedProgressStyle = useAnimatedStyle(() => {
    const backgroundColor = interpolateColor(
      statusColorVal.value,
      [0, 1, 2],
      ['#ff9f1c', '#10b981', '#f43f5e']
    );
    return {
      width: `${progressAnim.value * 100}%`,
      backgroundColor,
    };
  });

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
      message: 'Align face within HUD bounds to start calibration',
    });
    setLiveStats({
      ear: 0.320,
      mar: 0.140,
      yaw: 0.0,
      pitch: 0.0,
      fps: 30,
    });
  };

  const handleSimulateFrameUpdate = (action: 'BLINK_OK' | 'SMILE_OK' | 'TURN_OK') => {
    const mockLandmarks = Array.from({ length: 468 }, () => ({ x: 0, y: 0, z: 0 }));
    const currentChallenge = challengesList[activeChallengeIdx];

    if (action === 'BLINK_OK' && currentChallenge === 'BLINK') {
      livenessService.calibrate(0.30, 0.15); // force baseline setup
      for (let i = 0; i < 15; i++) {
        livenessService.processFrame(mockLandmarks, 'BLINK');
      }
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
        message: `Challenge Step ${nextIdx + 1} of ${challengesList.length}: ${challengesList[nextIdx]}`,
      }));
      
      ringScaleVal.value = 1.08;
      setTimeout(() => { ringScaleVal.value = 1.0; }, 180);
    } else {
      statusColorVal.value = 1; // Emerald (Passed Liveness)
      ringScaleVal.value = 1.05;

      setChallengeState({
        currentChallenge: 'SUCCESS',
        progress: 1.0,
        isCalibrated: true,
        message: 'Liveness approved. Commencing vector similarity check...',
      });

      if (activeUser) {
        const inputBuffer = new Float32Array(128);
        const embedding = await embedderService.generateEmbedding(inputBuffer);
        const enrolledVector = new Float32Array(activeUser.embedding);
        const result = embedderService.verifyMatch(embedding, enrolledVector);

        if (result.match) {
          await ledgerService.recordTransaction(
            activeUser.id,
            28.6139, // Delhi Lat
            77.2090, // Delhi Lon
            result.confidence,
            'VERIFIED'
          );
          
          setChallengeState(prev => ({
            ...prev,
            message: `User Authenticated: ${activeUser.name}\nVector Match Confidence: ${(result.confidence * 100).toFixed(1)}%`,
          }));
          Alert.alert('Verification Success', `Matched identity: ${activeUser.name} (${activeUser.role}) with ${(result.confidence * 100).toFixed(1)}% confidence.`);
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
            message: 'Biometric mismatch. Check-in denied.',
          }));
        }
      }
      await refreshLogs();
    }
  };

  const handleCorruptLedger = async () => {
    const list = await dbService.getLedger();
    if (list.length < 2) {
      Alert.alert('Demo Halt', 'Perform at least 2 scan cycles to build transaction history blocks.');
      return;
    }

    const tamperedList = [...list];
    tamperedList[0].userId = 'ATTEMPTED_BYPASS_99';
    await dbService.saveLedger(tamperedList);
    await refreshLogs();
    Alert.alert('Tampered DB Cache', 'Intentionally injected rogue User ID details to simulate system tampering.');
  };

  const handleVerifyChain = async () => {
    const res = await ledgerService.verifyLedgerIntegrity();
    if (res.valid) {
      Alert.alert('Chain Valid', '100% cryptographic ledger checks passed. Data integrity verified.');
    } else {
      statusColorVal.value = 2; // Crimson
      Alert.alert(
        '🚨 DATA COMPROMISED!',
        `Ledger integrity check failed at index ${res.errorIndex}. Hash chaining mismatch. Background syncing locked down.`,
        [
          { 
            text: 'Trigger Recalibration / Heal', 
            onPress: async () => {
              const list = await dbService.getLedger();
              if (list.length > 0 && res.errorIndex >= 0) {
                list[res.errorIndex].userId = activeUser ? activeUser.id : 'NHAI-2026-001';
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
                Alert.alert('Chain Healed', 'Rebuilt block ledger hashes. System status back to nominal.');
              }
            } 
          },
          { text: 'Dismiss', style: 'cancel' }
        ]
      );
    }
  };

  const handleTriggerSync = async () => {
    setSyncStatusMsg('Syncing ledger queue to AWS...');
    const result = await syncService.triggerSync();
    setSyncStatusMsg(result.message);
    await refreshLogs();
    Alert.alert(result.success ? 'Sync Completed' : 'Sync Terminated', result.message);
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Brand Header */}
      <View style={styles.appHeader}>
        <View>
          <Text style={styles.appTitle}>NHAI EDGE ID</Text>
          <Text style={styles.appSubtitle}>Offline Verification Terminal</Text>
        </View>
        <View style={styles.statusGroup}>
          <View style={styles.latencyBadge}>
            <Text style={styles.latencyText}>140ms latency</Text>
          </View>
          <View style={styles.offlineBadge}>
            <View style={styles.statusDot} />
            <Text style={styles.offlineText}>OFF-GRID</Text>
          </View>
        </View>
      </View>

      {/* Screen View tabs with bouncy press feedbacks */}
      <View style={styles.tabBar}>
        <ScalePress
          style={[styles.tabItem, activeTab === 'scan' && styles.tabActive]}
          onPress={() => setActiveTab('scan')}
        >
          <ScanIcon color={activeTab === 'scan' ? '#ff9f1c' : '#9ca3af'} />
          <Text style={[styles.tabText, activeTab === 'scan' && styles.tabTextActive]}>Scanner</Text>
        </ScalePress>

        <ScalePress
          style={[styles.tabItem, activeTab === 'logs' && styles.tabActive]}
          onPress={() => setActiveTab('logs')}
        >
          <LogsIcon color={activeTab === 'logs' ? '#ff9f1c' : '#9ca3af'} />
          <Text style={[styles.tabText, activeTab === 'logs' && styles.tabTextActive]}>Ledger Logs</Text>
        </ScalePress>

        <ScalePress
          style={[styles.tabItem, activeTab === 'security' && styles.tabActive]}
          onPress={() => setActiveTab('security')}
        >
          <ShieldIcon color={activeTab === 'security' ? '#ff9f1c' : '#9ca3af'} />
          <Text style={[styles.tabText, activeTab === 'security' && styles.tabTextActive]}>Security</Text>
        </ScalePress>
      </View>

      <ScrollView 
        contentContainerStyle={styles.scrollContent} 
        showsVerticalScrollIndicator={false}
      >
        {activeTab === 'scan' && (
          <View style={styles.tabContent}>
            
            {/* Liveness Challenge Progress Track (Pill Steps) */}
            <View style={styles.trackerRow}>
              {challengesList.map((item, idx) => {
                const isCompleted = idx < activeChallengeIdx;
                const isActive = idx === activeChallengeIdx;
                const label = item === 'TURN_LEFT' ? 'TURN' : item;
                
                return (
                  <View key={item} style={styles.trackerStepWrapper}>
                    <View style={[
                      styles.trackerCircle,
                      isCompleted && styles.trackerCircleDone,
                      isActive && styles.trackerCircleActive,
                    ]}>
                      {isCompleted ? (
                        <CheckIcon color="#ffffff" />
                      ) : (
                        <Text style={[
                          styles.trackerIndexText,
                          isActive && styles.trackerIndexTextActive
                        ]}>
                          {idx + 1}
                        </Text>
                      )}
                    </View>
                    <Text style={[
                      styles.trackerLabel,
                      isActive && styles.trackerLabelActive,
                      isCompleted && styles.trackerLabelDone
                    ]}>
                      {label}
                    </Text>
                    {idx < challengesList.length - 1 && (
                      <View style={[
                        styles.trackerLine,
                        idx < activeChallengeIdx && styles.trackerLineDone
                      ]} />
                    )}
                  </View>
                );
              })}
            </View>

            {/* Circular Scanner viewport */}
            <View style={styles.scannerWrapper}>
              {/* Absolute ambient backing glow */}
              <View style={[
                styles.ambientGlow,
                statusColorVal.value === 1 && styles.glowEmerald,
                statusColorVal.value === 2 && styles.glowRose,
              ]} />

              {/* Geometric Corner Brackets */}
              <View style={[styles.bracket, styles.topLeftBracket]} />
              <View style={[styles.bracket, styles.topRightBracket]} />
              <View style={[styles.bracket, styles.bottomLeftBracket]} />
              <View style={[styles.bracket, styles.bottomRightBracket]} />

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
                    <ActivityIndicator size="large" color="#ff9f1c" />
                    <Text style={styles.placeholderText}>Camera Feed Offline</Text>
                  </View>
                )}
                
                {/* Laser Scanning Line */}
                <Animated.View style={[styles.laserScanLine, animatedScanLineStyle]} />
              </Animated.View>
              
              {/* Radial HUD rings overlay */}
              <View style={styles.hudOverlay} pointerEvents="none">
                <Svg height="100%" width="100%" viewBox="0 0 100 100">
                  {/* Detailed scopes and reticles */}
                  <Circle cx="50" cy="50" r="48" stroke="rgba(255, 255, 255, 0.05)" strokeWidth="0.5" fill="none" />
                  <Circle cx="50" cy="50" r="44" stroke="rgba(255, 255, 255, 0.03)" strokeWidth="0.8" strokeDasharray="3 3" fill="none" />
                  <Circle cx="50" cy="50" r="28" stroke="rgba(255, 255, 255, 0.02)" strokeWidth="0.5" strokeDasharray="2 18" fill="none" />
                  {/* Scope axis ticks */}
                  <Line x1="50" y1="2" x2="50" y2="6" stroke="rgba(255, 255, 255, 0.15)" strokeWidth="0.8" />
                  <Line x1="50" y1="94" x2="50" y2="98" stroke="rgba(255, 255, 255, 0.15)" strokeWidth="0.8" />
                  <Line x1="2" y1="50" x2="6" y2="50" stroke="rgba(255, 255, 255, 0.15)" strokeWidth="0.8" />
                  <Line x1="94" y1="50" x2="98" y2="50" stroke="rgba(255, 255, 255, 0.15)" strokeWidth="0.8" />
                </Svg>
              </View>

              {/* Monospaced system telemetry HUD callouts */}
              <View style={styles.hudTextContainerLeft} pointerEvents="none">
                <Text style={styles.hudScopeText}>[ FRAME_PREPROC: CLAHE ]</Text>
              </View>
              <View style={styles.hudTextContainerRight} pointerEvents="none">
                <Text style={styles.hudScopeText}>[ ENGINE: INT8_GPU ]</Text>
              </View>
            </View>

            {/* Live Feature Extraction Stats Indicators */}
            <View style={styles.liveTelemetryCard}>
              <View style={styles.telemetryItem}>
                <Text style={styles.telemetryVal}>{liveStats.ear.toFixed(3)}</Text>
                <Text style={styles.telemetryLbl}>EAR (Eyes)</Text>
              </View>
              <View style={styles.telemetryDivider} />
              <View style={styles.telemetryItem}>
                <Text style={styles.telemetryVal}>{liveStats.mar.toFixed(3)}</Text>
                <Text style={styles.telemetryLbl}>MAR (Mouth)</Text>
              </View>
              <View style={styles.telemetryDivider} />
              <View style={styles.telemetryItem}>
                <Text style={styles.telemetryVal}>{liveStats.yaw >= 0 ? `+${liveStats.yaw}°` : `${liveStats.yaw}°`}</Text>
                <Text style={styles.telemetryLbl}>Yaw (Tilt)</Text>
              </View>
              <View style={styles.telemetryDivider} />
              <View style={styles.telemetryItem}>
                <Text style={styles.telemetryVal}>{liveStats.fps} Hz</Text>
                <Text style={styles.telemetryLbl}>Tracking Rate</Text>
              </View>
            </View>

            {/* Message HUD Panel */}
            <View style={styles.glassMessageCard}>
              <Animated.Text style={[styles.hudText, animatedMessageStyle]}>
                {challengeState.message}
              </Animated.Text>
              
              {/* Smooth Progress Indicators */}
              <View style={styles.progressContainer}>
                <View style={styles.progressBarBg}>
                  <Animated.View style={[styles.progressBarFill, animatedProgressStyle]} />
                </View>
                <View style={styles.progressMetrics}>
                  <Text style={styles.progressText}>
                    CHALLENGE: {challengeState.currentChallenge}
                  </Text>
                  <Text style={styles.progressPct}>
                    {Math.round(challengeState.progress * 100)}%
                  </Text>
                </View>
              </View>
            </View>

            {/* Simulated Frame Action Buttons */}
            <View style={styles.actionPanel}>
              <Text style={styles.panelTitle}>DIAGNOSTIC TEST CONTROLS</Text>
              <Text style={styles.panelSubtitle}>Simulate real-time camera frames and user actions</Text>
              
              <View style={styles.gridRow}>
                <ScalePress 
                  style={[
                    styles.actionCard, 
                    challengesList[activeChallengeIdx] !== 'BLINK' && styles.actionCardDisabled
                  ]} 
                  onPress={() => handleSimulateFrameUpdate('BLINK_OK')}
                  disabled={challengesList[activeChallengeIdx] !== 'BLINK'}
                >
                  <View style={[styles.cardDot, challengesList[activeChallengeIdx] === 'BLINK' && styles.cardDotActive]} />
                  <Text style={styles.actionCardTitle}>Blink Eyes</Text>
                  <Text style={styles.actionCardDesc}>Simulate low Eye Aspect Ratio (EAR)</Text>
                </ScalePress>

                <ScalePress 
                  style={[
                    styles.actionCard, 
                    challengesList[activeChallengeIdx] !== 'SMILE' && styles.actionCardDisabled
                  ]} 
                  onPress={() => handleSimulateFrameUpdate('SMILE_OK')}
                  disabled={challengesList[activeChallengeIdx] !== 'SMILE'}
                >
                  <View style={[styles.cardDot, challengesList[activeChallengeIdx] === 'SMILE' && styles.cardDotActive]} />
                  <Text style={styles.actionCardTitle}>Smile Gesture</Text>
                  <Text style={styles.actionCardDesc}>Simulate Mouth Aspect Ratio (MAR) shift</Text>
                </ScalePress>
              </View>

              <View style={styles.gridRow}>
                <ScalePress 
                  style={[
                    styles.actionCard, 
                    challengesList[activeChallengeIdx] !== 'TURN_LEFT' && styles.actionCardDisabled
                  ]} 
                  onPress={() => handleSimulateFrameUpdate('TURN_OK')}
                  disabled={challengesList[activeChallengeIdx] !== 'TURN_LEFT'}
                >
                  <View style={[styles.cardDot, challengesList[activeChallengeIdx] === 'TURN_LEFT' && styles.cardDotActive]} />
                  <Text style={styles.actionCardTitle}>Turn Left</Text>
                  <Text style={styles.actionCardDesc}>Simulate Yaw rotation angle estimation</Text>
                </ScalePress>

                <ScalePress 
                  style={[styles.actionCard, styles.resetCard]} 
                  onPress={handleResetVerification}
                >
                  <Text style={[styles.actionCardTitle, { color: '#ff9f1c' }]}>Reset Scan</Text>
                  <Text style={styles.actionCardDesc}>Purge tracking baselines and regenerate list</Text>
                </ScalePress>
              </View>
            </View>
          </View>
        )}

        {activeTab === 'logs' && (
          <View style={styles.tabContent}>
            <View style={styles.logsMetaRow}>
              <View style={styles.metaBox}>
                <Text style={styles.metaVal}>{logsList.length}</Text>
                <Text style={styles.metaLbl}>Total Logs</Text>
              </View>
              <View style={styles.metaBox}>
                <Text style={styles.metaVal}>
                  {logsList.filter(l => l.status === 'VERIFIED').length}
                </Text>
                <Text style={styles.metaLbl}>Verified</Text>
              </View>
              <View style={styles.metaBox}>
                <Text style={[styles.metaVal, { color: '#f43f5e' }]}>
                  {logsList.filter(l => l.status === 'FAILED').length}
                </Text>
                <Text style={styles.metaLbl}>Rejections</Text>
              </View>
            </View>

            {/* List of ledger transaction blocks */}
            <View style={styles.logListContainer}>
              <Text style={styles.sectionHeaderTitle}>SECURE HASH-CHAIN RECORDS</Text>
              {logsList.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>No ledger logs recorded in local memory yet.</Text>
                  <Text style={styles.emptySubtext}>Perform scanner loops to record new tamper-proof logs.</Text>
                </View>
              ) : (
                <View style={styles.timelineWrapper}>
                  {/* Vertical dotted connector timeline line representing block chain connections */}
                  <View style={styles.verticalTimelineBar} />
                  
                  {logsList.map((log, index) => {
                    const isVerified = log.status === 'VERIFIED';
                    return (
                      <View key={log.id} style={styles.timelineItemRow}>
                        
                        {/* Timeline Node Connector Indicator */}
                        <View style={styles.timelineIndicatorNode}>
                          <View style={[
                            styles.timelineNodePoint, 
                            isVerified ? styles.nodePointGreen : styles.nodePointRed
                          ]} />
                          {index < logsList.length - 1 && <View style={styles.linkChainLine} />}
                        </View>

                        <View style={styles.secureLogCard}>
                          <View style={styles.secureLogHeader}>
                            <View style={styles.blockBadge}>
                              <Text style={styles.blockBadgeText}>BLOCK #{logsList.length - index}</Text>
                            </View>
                            
                            <View style={styles.ledgerTimestampRow}>
                              <LockIcon color="rgba(255, 255, 255, 0.3)" />
                              <Text style={styles.blockTimestampText}>Deterministically Signed</Text>
                            </View>

                            <View style={[styles.statusIndicator, isVerified ? styles.statusIncGreen : styles.statusIncRed]}>
                              <Text style={isVerified ? styles.statusTextGreen : styles.statusTextRed}>
                                {log.status}
                              </Text>
                            </View>
                          </View>

                          <View style={styles.logMetaDetails}>
                            <View style={styles.detailRow}>
                              <Text style={styles.detailTitle}>Personnel ID:</Text>
                              <Text style={styles.detailVal}>{log.userId}</Text>
                            </View>
                            <View style={styles.detailRow}>
                              <Text style={styles.detailTitle}>Timestamp:</Text>
                              <Text style={styles.detailVal}>{new Date(log.timestamp).toLocaleTimeString()}</Text>
                            </View>
                            <View style={styles.detailRow}>
                              <Text style={styles.detailTitle}>Coordinates:</Text>
                              <Text style={styles.detailVal}>{log.latitude.toFixed(5)}, {log.longitude.toFixed(5)}</Text>
                            </View>
                            <View style={styles.detailRow}>
                              <Text style={styles.detailTitle}>Similarity Match:</Text>
                              <Text style={styles.detailVal}>{(log.confidence * 100).toFixed(1)}%</Text>
                            </View>
                          </View>

                          <View style={styles.hashChainWrapper}>
                            <View style={styles.hashRow}>
                              <Text style={styles.hashLabel}>PREV_HASH:</Text>
                              <Text style={styles.hashText} numberOfLines={1} ellipsizeMode="middle">{log.prevHash}</Text>
                            </View>
                            <View style={[styles.hashRow, { borderTopWidth: 0.5, borderTopColor: 'rgba(255, 255, 255, 0.05)' }]}>
                              <Text style={styles.hashLabel}>BLOCK_HASH:</Text>
                              <Text style={[styles.hashText, { color: '#60a5fa' }]} numberOfLines={1} ellipsizeMode="middle">{log.hash}</Text>
                            </View>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          </View>
        )}

        {activeTab === 'security' && (
          <View style={styles.tabContent}>
            {/* Encryption & Cryptography explanation card */}
            <View style={styles.securityHighlightCard}>
              <View style={styles.shieldBigWrapper}>
                <ShieldIcon color="#ff9f1c" />
              </View>
              <Text style={styles.securityTitle}>SHA-256 Ledger Security</Text>
              <Text style={styles.securityDesc}>
                This system runs a local tamper-proof ledger. Every toll transaction is signed with a SHA-256 hash using the previous transaction's signature. Changing any single transaction breaks the chain immediately.
              </Text>
            </View>

            {/* Cryptographic operations */}
            <View style={styles.controlBox}>
              <Text style={styles.controlBoxHeader}>LEDGER SYSTEM TESTS</Text>
              
              <ScalePress 
                style={[styles.securityActionRow, styles.rowGreen]} 
                onPress={handleVerifyChain}
              >
                <View style={styles.rowIconArea}>
                  <ShieldIcon color="#10b981" />
                </View>
                <View style={styles.rowTextArea}>
                  <Text style={styles.rowActionTitle}>Integrity Self-Test</Text>
                  <Text style={styles.rowActionDesc}>Re-run complete SHA-256 validation checks on all historical log blocks.</Text>
                </View>
              </ScalePress>

              <ScalePress 
                style={[styles.securityActionRow, styles.rowRed]} 
                onPress={handleCorruptLedger}
              >
                <View style={styles.rowIconArea}>
                  <Svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <Path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" stroke="#f43f5e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                </View>
                <View style={styles.rowTextArea}>
                  <Text style={styles.rowActionTitle}>Inject DB Corruption</Text>
                  <Text style={styles.rowActionDesc}>Sideload invalid User data inside local database history to simulate tampering.</Text>
                </View>
              </ScalePress>
            </View>

            {/* Cloud connectivity operations */}
            <View style={styles.controlBox}>
              <Text style={styles.controlBoxHeader}>AWS NETWORK SYNCHRONIZATION</Text>

              <View style={styles.syncStateDisplay}>
                <Text style={styles.syncStateHeading}>Queue Status</Text>
                <Text style={styles.syncStateSub}>{syncStatusMsg}</Text>
              </View>

              <ScalePress 
                style={styles.primarySyncButton} 
                onPress={handleTriggerSync}
              >
                <Text style={styles.primarySyncText}>Sync Queue & Purge Cache</Text>
              </ScalePress>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#060913', // Deep premium slate black background
  },
  appHeader: {
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 12 : 20,
    paddingBottom: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.04)',
    backgroundColor: '#070c19',
  },
  appTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 2,
  },
  appSubtitle: {
    fontSize: 10,
    color: '#9ca3af',
    fontWeight: '500',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  statusGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  latencyBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  latencyText: {
    color: '#9ca3af',
    fontWeight: '700',
    fontSize: 9,
  },
  offlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 159, 28, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 159, 28, 0.22)',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#ff9f1c',
    marginRight: 5,
  },
  offlineText: {
    color: '#ff9f1c',
    fontWeight: '800',
    fontSize: 9,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#070c19',
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.04)',
  },
  tabItem: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 6,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: '#ff9f1c',
  },
  tabText: {
    fontSize: 12,
    color: '#9ca3af',
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#ff9f1c',
    fontWeight: '800',
  },
  scrollContent: {
    flexGrow: 1,
  },
  tabContent: {
    padding: 20,
    alignItems: 'center',
    width: '100%',
  },
  
  // Track Steps UI
  trackerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 10,
    marginBottom: 26,
    marginTop: 6,
  },
  trackerStepWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
    flex: 1,
  },
  trackerCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  trackerCircleActive: {
    borderColor: '#ff9f1c',
    backgroundColor: 'rgba(255, 159, 28, 0.15)',
    shadowColor: '#ff9f1c',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  trackerCircleDone: {
    borderColor: '#10b981',
    backgroundColor: '#10b981',
  },
  trackerIndexText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#9ca3af',
  },
  trackerIndexTextActive: {
    color: '#ff9f1c',
  },
  trackerLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#6b7280',
    marginLeft: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    zIndex: 2,
  },
  trackerLabelActive: {
    color: '#ff9f1c',
  },
  trackerLabelDone: {
    color: '#10b981',
  },
  trackerLine: {
    position: 'absolute',
    left: 20,
    right: 12,
    top: 12,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    zIndex: 1,
  },
  trackerLineDone: {
    backgroundColor: '#10b981',
  },

  // Scanner viewport UI
  scannerWrapper: {
    width: SCAN_RING_SIZE,
    height: SCAN_RING_SIZE,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  ambientGlow: {
    position: 'absolute',
    width: SCAN_RING_SIZE - 20,
    height: SCAN_RING_SIZE - 20,
    borderRadius: (SCAN_RING_SIZE - 20) / 2,
    backgroundColor: 'rgba(255, 159, 28, 0.03)',
    zIndex: 0,
  },
  glowEmerald: {
    backgroundColor: 'rgba(16, 185, 129, 0.04)',
  },
  glowRose: {
    backgroundColor: 'rgba(244, 63, 94, 0.04)',
  },
  scanRing: {
    width: SCAN_RING_SIZE,
    height: SCAN_RING_SIZE,
    borderRadius: SCAN_RING_SIZE / 2,
    borderWidth: 3,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#020409',
    elevation: 12,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
  },
  camera: {
    width: '100%',
    height: '100%',
  },
  cameraPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: '#0a0d17',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 8,
    fontWeight: '500',
  },
  laserScanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
  },
  hudOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  bracket: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    zIndex: 10,
  },
  topLeftBracket: {
    top: -4,
    left: -4,
    borderTopWidth: 2,
    borderLeftWidth: 2,
  },
  topRightBracket: {
    top: -4,
    right: -4,
    borderTopWidth: 2,
    borderRightWidth: 2,
  },
  bottomLeftBracket: {
    bottom: -4,
    left: -4,
    borderBottomWidth: 2,
    borderLeftWidth: 2,
  },
  bottomRightBracket: {
    bottom: -4,
    right: -4,
    borderBottomWidth: 2,
    borderRightWidth: 2,
  },
  hudTextContainerLeft: {
    position: 'absolute',
    bottom: 8,
    left: -32,
    zIndex: 11,
  },
  hudTextContainerRight: {
    position: 'absolute',
    bottom: 8,
    right: -32,
    zIndex: 11,
  },
  hudScopeText: {
    color: 'rgba(255, 255, 255, 0.15)',
    fontSize: 7,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    fontWeight: '600',
  },

  // Live Feature Extraction Stats Indicator
  liveTelemetryCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.015)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 8,
    marginBottom: 20,
  },
  telemetryItem: {
    flex: 1,
    alignItems: 'center',
  },
  telemetryVal: {
    fontSize: 12,
    fontWeight: '900',
    color: '#ffffff',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  telemetryLbl: {
    fontSize: 8,
    color: '#6b7280',
    fontWeight: '700',
    marginTop: 2,
    textTransform: 'uppercase',
  },
  telemetryDivider: {
    width: 0.5,
    height: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },

  // Glassmorphic prompt card
  glassMessageCard: {
    width: '100%',
    backgroundColor: 'rgba(12, 18, 38, 0.85)',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
  },
  hudText: {
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 22,
    letterSpacing: 0.3,
  },
  progressContainer: {
    width: '100%',
  },
  progressBarBg: {
    width: '100%',
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 10,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 2,
  },
  progressMetrics: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressText: {
    fontSize: 9,
    color: '#9ca3af',
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  progressPct: {
    fontSize: 10,
    color: '#ffffff',
    fontWeight: '900',
  },

  // Control Actions layout
  actionPanel: {
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.015)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 20,
    padding: 16,
  },
  panelTitle: {
    fontSize: 11,
    fontWeight: '900',
    color: '#9ca3af',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  panelSubtitle: {
    fontSize: 9,
    color: '#6b7280',
    marginBottom: 16,
    fontWeight: '500',
  },
  gridRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  actionCard: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.025)',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
  },
  actionCardDisabled: {
    opacity: 0.35,
  },
  resetCard: {
    borderColor: 'rgba(255, 159, 28, 0.15)',
    backgroundColor: 'rgba(255, 159, 28, 0.02)',
  },
  cardDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    position: 'absolute',
    top: 14,
    right: 14,
  },
  cardDotActive: {
    backgroundColor: '#ff9f1c',
  },
  actionCardTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: 4,
  },
  actionCardDesc: {
    fontSize: 9,
    color: '#6b7280',
    lineHeight: 12,
  },

  // Logs view layout
  logsMetaRow: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
    marginBottom: 20,
  },
  metaBox: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.015)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  metaVal: {
    fontSize: 18,
    fontWeight: '900',
    color: '#10b981',
  },
  metaLbl: {
    fontSize: 9,
    color: '#9ca3af',
    fontWeight: '700',
    marginTop: 4,
    textTransform: 'uppercase',
  },
  logListContainer: {
    width: '100%',
  },
  timelineWrapper: {
    position: 'relative',
    width: '100%',
    paddingLeft: 12,
  },
  verticalTimelineBar: {
    position: 'absolute',
    top: 12,
    bottom: 24,
    left: 20,
    width: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderStyle: 'dashed',
  },
  timelineItemRow: {
    flexDirection: 'row',
    width: '100%',
    marginBottom: 16,
  },
  timelineIndicatorNode: {
    width: 20,
    alignItems: 'center',
    marginRight: 10,
    marginTop: 18,
  },
  timelineNodePoint: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ff9f1c',
    zIndex: 3,
  },
  nodePointGreen: {
    backgroundColor: '#10b981',
    shadowColor: '#10b981',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 4,
  },
  nodePointRed: {
    backgroundColor: '#f43f5e',
    shadowColor: '#f43f5e',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 4,
  },
  linkChainLine: {
    // Spacer element
  },
  sectionHeaderTitle: {
    fontSize: 11,
    fontWeight: '900',
    color: '#9ca3af',
    letterSpacing: 1.5,
    marginBottom: 12,
  },
  emptyContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.01)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.03)',
    paddingVertical: 40,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  emptyText: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptySubtext: {
    color: '#6b7280',
    fontSize: 10,
    marginTop: 6,
    textAlign: 'center',
  },
  secureLogCard: {
    flex: 1,
    backgroundColor: '#0a0e1b',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 14,
    padding: 14,
  },
  secureLogHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255, 255, 255, 0.04)',
    paddingBottom: 8,
  },
  blockBadge: {
    backgroundColor: 'rgba(96, 165, 250, 0.08)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  blockBadgeText: {
    color: '#60a5fa',
    fontSize: 9,
    fontWeight: '900',
  },
  ledgerTimestampRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  blockTimestampText: {
    fontSize: 8,
    color: 'rgba(255, 255, 255, 0.35)',
    fontWeight: '600',
  },
  statusIndicator: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusIncGreen: {
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
  },
  statusIncRed: {
    backgroundColor: 'rgba(244, 63, 94, 0.08)',
  },
  statusTextGreen: {
    color: '#10b981',
    fontSize: 9,
    fontWeight: '900',
  },
  statusTextRed: {
    color: '#f43f5e',
    fontSize: 9,
    fontWeight: '900',
  },
  logMetaDetails: {
    gap: 6,
    marginBottom: 12,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  detailTitle: {
    color: '#9ca3af',
    fontSize: 11,
    fontWeight: '600',
  },
  detailVal: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  hashChainWrapper: {
    backgroundColor: 'rgba(0, 0, 0, 0.15)',
    borderRadius: 8,
    padding: 8,
    gap: 4,
  },
  hashRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
  },
  hashLabel: {
    fontSize: 8,
    fontWeight: '800',
    color: '#6b7280',
    width: 65,
  },
  hashText: {
    flex: 1,
    fontSize: 8,
    color: '#9ca3af',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },

  // Security view layout
  securityHighlightCard: {
    width: '100%',
    backgroundColor: 'rgba(255, 159, 28, 0.02)',
    borderColor: 'rgba(255, 159, 28, 0.06)',
    borderWidth: 1,
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
    marginBottom: 20,
  },
  shieldBigWrapper: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 159, 28, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  securityTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#ffffff',
    marginBottom: 8,
  },
  securityDesc: {
    fontSize: 11,
    color: '#9ca3af',
    textAlign: 'center',
    lineHeight: 18,
    fontWeight: '500',
  },
  controlBox: {
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.015)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.03)',
    padding: 16,
    marginBottom: 20,
  },
  controlBoxHeader: {
    fontSize: 10,
    fontWeight: '900',
    color: '#9ca3af',
    letterSpacing: 1.5,
    marginBottom: 14,
  },
  securityActionRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.015)',
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.03)',
  },
  rowGreen: {
    borderColor: 'rgba(16, 185, 129, 0.12)',
    backgroundColor: 'rgba(16, 185, 129, 0.02)',
  },
  rowRed: {
    borderColor: 'rgba(244, 63, 94, 0.12)',
    backgroundColor: 'rgba(244, 63, 94, 0.02)',
  },
  rowIconArea: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  rowTextArea: {
    flex: 1,
  },
  rowActionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: 2,
  },
  rowActionDesc: {
    fontSize: 10,
    color: '#6b7280',
    lineHeight: 14,
  },
  syncStateDisplay: {
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  syncStateHeading: {
    fontSize: 10,
    color: '#9ca3af',
    fontWeight: '800',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  syncStateSub: {
    fontSize: 11,
    color: '#ff9f1c',
    fontWeight: '700',
  },
  primarySyncButton: {
    backgroundColor: '#ff9f1c',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primarySyncText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
});
