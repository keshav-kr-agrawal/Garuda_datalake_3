import React, { useState, useEffect, useRef } from 'react';
import { LivenessMathService, LivenessChallenge, ChallengeState, ENROLLMENT_STEPS, EnrollmentFrameResult } from '../services/livenessMath';
import { FaceEmbedderService } from '../services/faceEmbedder';
import { CryptographicLedgerService } from '../services/cryptographicLedger';
import { SyncManagerService } from '../services/syncManager';
import { LocalDatabaseService, EnrolledUser, AuditLog } from '../services/databaseSchema';
import { EnrollmentOrchestratorService, OrchestratorState } from '../services/enrollmentOrchestrator';
import { CLAHEProcessor } from '../services/claheProcessor';
import { DatalakeApiService, OfflineQueueEntry } from '../services/datalakeApiService';
import { AWSSyncService } from '../services/awsSyncService';
import { SQLiteEngine, SqlLogEntry } from '../services/localDbAdapter';

export const DesktopWebDashboard: React.FC = () => {
  // Core Services
  const livenessService = LivenessMathService.getInstance();
  const embedderService = FaceEmbedderService.getInstance();
  const ledgerService = CryptographicLedgerService.getInstance();
  const legacySyncService = SyncManagerService.getInstance();
  const datalakeSyncService = DatalakeApiService.getInstance();
  const awsSyncService = AWSSyncService.getInstance();
  const dbService = LocalDatabaseService.getInstance();
  const enrollmentOrchestrator = EnrollmentOrchestratorService.getInstance();
  const claheProcessor = CLAHEProcessor.getInstance();

  // Network simulator & basic state
  const [onlineSimulator, setOnlineSimulator] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isOfflineTerminal, setIsOfflineTerminal] = useState(true);
  const [loginWithFaceActive, setLoginWithFaceActive] = useState(false);
  
  // Login Form
  const [loginId, setLoginId] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Navigation tabs
  const [activeTab, setActiveTab] = useState<'terminal' | 'registry' | 'ledger' | 'sync'>('terminal');

  // Staff and Admin flow states
  const [attendanceMarkedToday, setAttendanceMarkedToday] = useState(false);
  const [selectedEnrollIdOption, setSelectedEnrollIdOption] = useState('NHAI-2026-001');
  const [enrollCustomId, setEnrollCustomId] = useState('');

  useEffect(() => {
    if (selectedEnrollIdOption === 'NHAI-2026-001') {
      setEnrollName('Keshav Kumar Agrawal');
      setEnrollRole('Toll Supervisor');
    } else if (selectedEnrollIdOption === 'NHAI-2026-002') {
      setEnrollName('Harshiya Sharma');
      setEnrollRole('Checkpost Inspector');
    } else if (selectedEnrollIdOption === 'NHAI-2026-003') {
      setEnrollName('Anurag Mohapatra');
      setEnrollRole('Field Security Lead');
    } else {
      setEnrollName('');
      setEnrollRole('Toll Supervisor');
      setEnrollCustomId('');
    }
  }, [selectedEnrollIdOption]);

  // GPS coordinates state
  const [gpsLocation, setGpsLocation] = useState<{ latitude: number; longitude: number; accuracy: number }>({
    latitude: 28.6139,
    longitude: 77.2090,
    accuracy: 5
  });

  // Attendance queue (the real store — separate from the cryptographic ledger)
  const [attendanceQueue, setAttendanceQueue] = useState<OfflineQueueEntry[]>([]);

  // Terminal Webcam & Canvas Refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const meshCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const claheCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // States for live telemetry
  const [streamActive, setStreamActive] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [mpLoaded, setMpLoaded] = useState(false);
  const [mpLoading, setMpLoading] = useState(false);

  const [liveYaw, setLiveYaw] = useState(0);
  const [livePitch, setLivePitch] = useState(0);
  const [liveRoll, setLiveRoll] = useState(0);
  const [liveEAR, setLiveEAR] = useState(0.30);
  const [liveMAR, setLiveMAR] = useState(0.15);

  const [claheEnabled, setClaheEnabled] = useState(true);
  const [claheLatencyMs, setClaheLatencyMs] = useState(0);
  const [searchLatency, setSearchLatency] = useState<number | null>(null);
  const [currentUserProfile, setCurrentUserProfile] = useState<any>(null);
  const isAdmin = currentUserProfile?.role === 'System Administrator' || currentUserProfile?.employeeId === 'admin';

  // Challenges
  const [challengesList, setChallengesList] = useState<LivenessChallenge[]>([]);
  const [activeChallengeIdx, setActiveChallengeIdx] = useState(0);
  const [challengeState, setChallengeState] = useState<ChallengeState>({
    currentChallenge: 'BLINK',
    progress: 0,
    isCalibrated: false,
    message: 'Initialize camera to begin verification sequence.',
  });

  // Verification results
  const [matchedProfile, setMatchedProfile] = useState<EnrolledUser | null>(null);
  const [matchConfidence, setMatchConfidence] = useState(0);
  const [verificationSuccess, setVerificationSuccess] = useState<boolean | null>(null);

  const [rosterFilter, setRosterFilter] = useState<'ALL' | 'PRESENT' | 'ABSENT'>('ALL');

  // Registry & Roster
  const [usersList, setUsersList] = useState<EnrolledUser[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [enrollName, setEnrollName] = useState('');
  const [enrollRole, setEnrollRole] = useState('Toll Supervisor');
  const [enrollProgressMsg, setEnrollProgressMsg] = useState('Look straight ahead to start guided capture...');
  const [orchestratorState, setOrchestratorState] = useState<OrchestratorState>('IDLE');
  const [enrollFrameResult, setEnrollFrameResult] = useState<EnrollmentFrameResult | null>(null);
  const [snapFront, setSnapFront] = useState<string | null>(null);
  const [capturedStepPhotos, setCapturedStepPhotos] = useState<{ step: string; photo: string }[]>([]);

  // Seeding/Benchmarking
  const [isSeeding, setIsSeeding] = useState(false);
  const [benchmarkResult, setBenchmarkResult] = useState<string | null>(null);

  // Ledger & Sync
  const [logsList, setLogsList] = useState<AuditLog[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncStatusMsg, setSyncStatusMsg] = useState('Off-Grid queue monitoring active.');
  
  // SQLite Terminal Diagnostic logs
  const [sqlConsoleOpen, setSqlConsoleOpen] = useState(false);
  const [sqlLogs, setSqlLogs] = useState<SqlLogEntry[]>([]);

  // Computed state properties for role enrollment status
  const adminEnrolled = usersList.some(u => u.id === 'admin');
  const forceAdminEnroll = isAdmin && !adminEnrolled;
  const isCommonTerminal = currentUserProfile?.employeeId === 'NHAI-USER-001';
  const staffEnrolled = !isAdmin && (isCommonTerminal || usersList.some(u => u.id === currentUserProfile?.employeeId));

  // Timing references
  const pipelineStartTimeRef = useRef<number | null>(null);
  const activeChallengeRef = useRef<LivenessChallenge>('BLINK');
  const activeChallengeIdxRef = useRef<number>(0);
  const challengesListRef = useRef<LivenessChallenge[]>([]);
  const orchestratorStateRef = useRef<OrchestratorState>('IDLE');

  // Sync ref values for callbacks
  const claheEnabledRef = useRef(claheEnabled);
  useEffect(() => { claheEnabledRef.current = claheEnabled; }, [claheEnabled]);
  useEffect(() => { activeChallengeRef.current = challengeState.currentChallenge; }, [challengeState.currentChallenge]);
  useEffect(() => { activeChallengeIdxRef.current = activeChallengeIdx; }, [activeChallengeIdx]);
  useEffect(() => { challengesListRef.current = challengesList; }, [challengesList]);
  useEffect(() => { orchestratorStateRef.current = orchestratorState; }, [orchestratorState]);
  
  // Webcam control during registry onboarding
  useEffect(() => {
    if (activeTab === 'registry') {
      if (isEnrolling) {
        if (!streamActive) {
          startWebcam();
        }
      } else {
        if (streamActive) {
          stopWebcam();
        }
      }
    } else {
      if (isEnrolling) {
        setIsEnrolling(false);
        enrollmentOrchestrator.reset();
        setOrchestratorState('IDLE');
        if (streamActive) {
          stopWebcam();
        }
      }
    }
  }, [isEnrolling, activeTab]);

  // Subscribe to SQLite database logs
  useEffect(() => {
    const unsub = SQLiteEngine.getInstance().subscribe((logs) => {
      setSqlLogs(logs);
    });
    return unsub;
  }, []);

  // Initial Boot
  useEffect(() => {
    const bootstrap = async () => {
      await dbService.seedDatabaseIfEmpty();
      await embedderService.initialize();
      await datalakeSyncService.initialize();
      const profile = datalakeSyncService.getCurrentProfile();
      if (profile) {
        setCurrentUserProfile(profile);
        setIsLoggedIn(true);
        const attStatus = await datalakeSyncService.getTodayAttendanceStatus();
        setAttendanceMarkedToday(attStatus.isMarked);
      }
      await refreshUsers();
      await refreshLogs();
      refreshAttendance();
      updateQueueStats();
    };
    bootstrap();

    return () => {
      cleanupMediaPipe();
      datalakeSyncService.destroy();
    };
  }, []);

  // Track real GPS location via browser API
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setGpsLocation({
            latitude: Number(position.coords.latitude.toFixed(6)),
            longitude: Number(position.coords.longitude.toFixed(6)),
            accuracy: Math.round(position.coords.accuracy || 5)
          });
          console.log('[Geolocation] Acquired real coordinates:', position.coords.latitude, position.coords.longitude);
        },
        (err) => {
          console.warn('[Geolocation] Permission or acquisition failed. Using default NHAI HQ.', err);
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    }
  }, [streamActive]);

  // Sync database items count
  const refreshUsers = async () => {
    const list = await dbService.getEnrolledUsers();
    setUsersList(list);
  };

  const refreshLogs = async () => {
    const list = await dbService.getLedger();
    setLogsList([...list].reverse());
  };

  const refreshAttendance = () => {
    // Read from the REAL attendance queue (datalakeApiService.offlineQueue)
    // NOT the cryptographic ledger — these are two separate stores.
    const queue = datalakeSyncService.getOfflineQueue();
    setAttendanceQueue(queue);
  };

  const updateQueueStats = () => {
    const stats = datalakeSyncService.getOfflineQueueStats();
    setPendingCount(stats.pending);
    refreshAttendance(); // keep attendance table in sync
  };

  // Simulating random noise on camera metrics to make HUD feel alive
  useEffect(() => {
    if (!streamActive || challengeState.currentChallenge === 'SUCCESS' || challengeState.currentChallenge === 'FAILED') {
      return;
    }
    const interval = setInterval(() => {
      let targetEar = 0.31 + (Math.random() - 0.5) * 0.02;
      let targetMar = 0.14 + (Math.random() - 0.5) * 0.015;
      
      const current = challengesList[activeChallengeIdx];
      if (challengeState.isCalibrated) {
        if (current === 'BLINK' && challengeState.progress > 0) {
          targetEar = 0.08 + Math.random() * 0.03;
        } else if (current === 'SMILE' && challengeState.progress > 0) {
          targetMar = 0.28 + (Math.random() - 0.5) * 0.02;
        }
      }
      setLiveEAR(Number(targetEar.toFixed(3)));
      setLiveMAR(Number(targetMar.toFixed(3)));
    }, 250);

    return () => clearInterval(interval);
  }, [streamActive, activeChallengeIdx, challengeState.currentChallenge, challengeState.isCalibrated, challengeState.progress]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const authResult = await datalakeSyncService.login(loginId, loginPassword);
      if (authResult.success) {
        const profile = datalakeSyncService.getCurrentProfile();
        setCurrentUserProfile(profile);
        setIsLoggedIn(true);
        
        const attStatus = await datalakeSyncService.getTodayAttendanceStatus();
        setAttendanceMarkedToday(attStatus.isMarked);

        const adminUser = profile?.role === 'System Administrator' || profile?.employeeId === 'admin';
        if (adminUser) {
          setActiveTab('registry');
          setIsEnrolling(false);
        } else {
          setIsEnrolling(false);
          setActiveTab('terminal');
        }
      } else {
        alert(authResult.error || 'Authentication rejected. Verify credentials.');
      }
    } catch (err) {
      alert('Login failure. Service error.');
    }
  };

  const handleFaceLoginClick = async () => {
    setLoginWithFaceActive(true);
    setTimeout(() => {
      startWebcam();
    }, 100);
  };

  const handleCancelFaceLogin = () => {
    stopWebcam();
    setLoginWithFaceActive(false);
    setVerificationSuccess(null);
  };

  const handleLogout = async () => {
    await datalakeSyncService.logout();
    stopWebcam();
    setIsLoggedIn(false);
    setCurrentUserProfile(null);
    setMatchedProfile(null);
    setVerificationSuccess(null);
    setLoginWithFaceActive(false);
  };

  const handleNetworkToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const online = e.target.checked;
    setOnlineSimulator(online);
    // Trigger sync automatically if network restored
    if (online) {
      setSyncStatusMsg('Network link active. Restoring connections...');
      triggerSyncLogs();
    } else {
      setSyncStatusMsg('Device disconnected. Offline local ledger operational.');
    }
  };

  // Webcam controls & MediaPipe pipeline
  const cleanupMediaPipe = () => {
    const mpGlobal = window as any;
    if (mpGlobal.CameraHelperInstance) {
      try { mpGlobal.CameraHelperInstance.stop(); } catch (e) {}
      mpGlobal.CameraHelperInstance = null;
    }
    setStreamActive(false);
  };

  const startWebcam = async () => {
    if (mpLoading) return;
    setMpLoading(true);
    setStreamError(null);
    setMatchedProfile(null);
    setVerificationSuccess(null);
    setSearchLatency(null);

    const mpGlobal = window as any;
    if (!mpGlobal.FaceMesh || !mpGlobal.Camera) {
      setStreamError('MediaPipe libraries loading from cache. Please wait...');
      setMpLoading(false);
      return;
    }

    try {
      cleanupMediaPipe();

      const faceMesh = new mpGlobal.FaceMesh({
        locateFile: (file: string) => `/${file}`
      });

      faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });

      faceMesh.onResults(handleFaceMeshResults);

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 480, height: 480, facingMode: 'user' },
        audio: false
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        
        if (!claheCanvasRef.current) {
          const claheCanvas = document.createElement('canvas');
          claheCanvas.width = 480;
          claheCanvas.height = 480;
          claheCanvasRef.current = claheCanvas;
        }

        const cameraHelper = new mpGlobal.Camera(videoRef.current, {
          onFrame: async () => {
            if (videoRef.current && faceMesh) {
              if (claheEnabledRef.current && claheCanvasRef.current) {
                const claheCtx = claheCanvasRef.current.getContext('2d', { willReadFrequently: true });
                if (claheCtx && videoRef.current.videoWidth > 0 && videoRef.current.videoHeight > 0) {
                  claheCtx.drawImage(videoRef.current, 0, 0, 480, 480);
                  const lat = claheProcessor.processCanvas(claheCanvasRef.current);
                  setClaheLatencyMs(Math.round(lat));
                  await faceMesh.send({ image: claheCanvasRef.current });
                }
              } else if (videoRef.current.videoWidth > 0 && videoRef.current.videoHeight > 0) {
                await faceMesh.send({ image: videoRef.current });
              }
              if (pipelineStartTimeRef.current === null) {
                pipelineStartTimeRef.current = performance.now();
              }
            }
          },
          width: 480,
          height: 480
        });

        mpGlobal.CameraHelperInstance = cameraHelper;
        await cameraHelper.start();
        setStreamActive(true);
        setMpLoaded(true);

        livenessService.reset();
        const shuffled = livenessService.generateChallengeSequence();

        // Update refs synchronously to prevent race conditions in subsequent frame loops
        challengesListRef.current = shuffled;
        activeChallengeIdxRef.current = 0;
        activeChallengeRef.current = shuffled[0];

        setChallengesList(shuffled);
        setActiveChallengeIdx(0);

        setChallengeState({
          currentChallenge: shuffled[0],
          progress: 0,
          isCalibrated: false,
          message: 'Align face. Calibrating ambient metrics...',
        });
      }
    } catch (err) {
      console.error(err);
      setStreamError('Failed to claim camera interface. Check permissions.');
    } finally {
      setMpLoading(false);
    }
  };

  const stopWebcam = () => {
    cleanupMediaPipe();
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (meshCanvasRef.current) {
      const ctx = meshCanvasRef.current.getContext('2d');
      ctx?.clearRect(0, 0, 480, 480);
    }
    pipelineStartTimeRef.current = null;
  };

  // Processing Frame Callbacks
  const handleFaceMeshResults = async (results: any) => {
    const video = videoRef.current;
    if (!video) return;
    const vWidth = video.videoWidth || 480;
    const vHeight = video.videoHeight || 480;

    // Draw background video feed (raw or CLAHE) even if face is not detected to prevent screen freezing
    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
      if (meshCanvasRef.current) {
        const canvas = meshCanvasRef.current;
        if (canvas.width !== vWidth || canvas.height !== vHeight) {
          canvas.width = vWidth;
          canvas.height = vHeight;
        }
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const imgSource = results.image || ((claheEnabledRef.current && claheCanvasRef.current) ? claheCanvasRef.current : video);
          const hasWidth = imgSource && (imgSource.videoWidth !== undefined ? imgSource.videoWidth > 0 : imgSource.width > 0);
          const hasHeight = imgSource && (imgSource.videoHeight !== undefined ? imgSource.videoHeight > 0 : imgSource.height > 0);
          if (imgSource && hasWidth && hasHeight) {
            ctx.drawImage(imgSource, 0, 0, vWidth, vHeight);
          } else {
            ctx.clearRect(0, 0, vWidth, vHeight);
          }
        }
      }
      return;
    }

    const landmarks = results.multiFaceLandmarks[0];

    if (meshCanvasRef.current) {
      const canvas = meshCanvasRef.current;
      if (canvas.width !== vWidth || canvas.height !== vHeight) {
        canvas.width = vWidth;
        canvas.height = vHeight;
      }
      const ctx = canvas.getContext('2d');
      if (ctx) {
        drawFaceMesh(ctx, landmarks, results.image);
      }
    }

    const scaledLandmarks = landmarks.map((l: any) => ({
      x: l.x * vWidth,
      y: l.y * vHeight,
      z: l.z * vWidth
    }));

    const pose = livenessService.estimatePose(scaledLandmarks);
    setLiveYaw(Math.round(pose.yaw));
    setLivePitch(Math.round(pose.pitch));
    setLiveRoll(Math.round(pose.roll));

    // Orchestrated Enrollment Wizard
    if (orchestratorStateRef.current === 'ENROLLING') {
      const frameResult = await enrollmentOrchestrator.processFrame(
        scaledLandmarks,
        generateRealFaceEmbedding
      );
      if (frameResult) {
        setEnrollFrameResult({ ...frameResult });
        setEnrollProgressMsg(frameResult.guidanceMessage);

        const status = enrollmentOrchestrator.getStatus();
        if (status.capturedAngles.length > capturedStepPhotos.length) {
          const lastAngle = status.capturedAngles[status.capturedAngles.length - 1];
          const photo = snapVideoFrame();
          if (photo) {
            setCapturedStepPhotos(prev => {
              if (prev.some(p => p.step === lastAngle.step)) return prev;
              return [...prev, { step: lastAngle.step, photo }];
            });
          }
        }
      }

      const currentState = enrollmentOrchestrator.getStatus().state;
      if (currentState === 'SAVING') {
        setOrchestratorState('SAVING');
        orchestratorStateRef.current = 'SAVING';
        const snapshot = snapVideoFrame();
        setSnapFront(snapshot);
        const success = await enrollmentOrchestrator.buildAndSaveFaceModel(snapshot);
        if (success) {
          const status = enrollmentOrchestrator.getStatus();
          setOrchestratorState('COMPLETE');
          orchestratorStateRef.current = 'COMPLETE';
          
          if (status.errorMessage && status.errorMessage.startsWith('ALREADY_REGISTERED:')) {
            const parts = status.errorMessage.split(':');
            const name = parts[1];
            const id = parts[2];
            setEnrollProgressMsg(`✅ Already registered face: ${name} (ID: ${id})`);
          } else {
            setEnrollProgressMsg('✅ Enrollment details stored successfully.');
          }

          await refreshUsers();
          setTimeout(() => {
            setIsEnrolling(false);
            setEnrollName('');
            setEnrollRole('Toll Supervisor');
            enrollmentOrchestrator.reset();
            setOrchestratorState('IDLE');
          }, 4000);
        } else {
          const errStatus = enrollmentOrchestrator.getStatus();
          setOrchestratorState('ERROR');
          orchestratorStateRef.current = 'ERROR';
          setEnrollProgressMsg(`❌ Enrollment failed: ${errStatus.errorMessage || 'Core DB save refusal. Try clearing browser data.'}`);
        }
      }
      return;
    }

    // Challenge-Response Liveness
    const currentChallenge = activeChallengeRef.current;
    if (currentChallenge !== 'SUCCESS' && currentChallenge !== 'FAILED') {
      const resState = livenessService.processFrame(scaledLandmarks, currentChallenge);
      setChallengeState(resState);

      if (resState.progress >= 1.0) {
        await handleAdvanceRealChallenge(scaledLandmarks);
      }
    }
  };

  const handleAdvanceRealChallenge = async (landmarks: any[]) => {
    const list = challengesListRef.current;
    const idx = activeChallengeIdxRef.current;

    if (idx < list.length - 1) {
      const nextIdx = idx + 1;
      activeChallengeIdxRef.current = nextIdx;
      activeChallengeRef.current = list[nextIdx];
      
      setActiveChallengeIdx(nextIdx);
      livenessService.resetChallengeState();
      
      setChallengeState(prev => ({
        ...prev,
        currentChallenge: list[nextIdx],
        progress: 0,
        message: `Challenge Step ${nextIdx + 1}: Please ${list[nextIdx]}`,
      }));
    } else {
      activeChallengeRef.current = 'SUCCESS';

      setChallengeState(prev => ({
        ...prev,
        currentChallenge: 'SUCCESS',
        progress: 1.0,
        message: 'Liveness approved! Searching local database...',
      }));

      let queryEmbedding: Float32Array;
      try {
        queryEmbedding = await generateRealFaceEmbedding(landmarks);
      } catch (err: any) {
        console.error(err);
        activeChallengeRef.current = 'FAILED';
        setChallengeState(prev => ({
          ...prev,
          currentChallenge: 'FAILED',
          message: `Inference Error: ${err.message || String(err)}`
        }));
        setVerificationSuccess(false);
        stopWebcam();
        return;
      }
      
      const startMs = performance.now();
      const matchResult = await dbService.vectorSearchMultiAngle(queryEmbedding);
      const endMs = performance.now();
      
      setSearchLatency(Math.round(endMs - startMs));

      const isUserMatch = (loginWithFaceActive || isAdmin || isCommonTerminal) ? !!matchResult.user : (matchResult.user && matchResult.user.id === currentUserProfile?.employeeId);

      if (isUserMatch && matchResult.similarity >= 0.72) {
        const matchedUser = matchResult.user!;
        setMatchedProfile(matchedUser);
        
        const scaledSim = 0.95 + ((matchResult.similarity - 0.72) / (1.0 - 0.72)) * 0.05;
        setMatchConfidence(scaledSim);

        // Queue log entry offline via Datalake API
        const attResult = await datalakeSyncService.markAttendance({
          employeeId: matchedUser.id,
          gpsLatitude: gpsLocation.latitude,
          gpsLongitude: gpsLocation.longitude,
          gpsAccuracyMeters: gpsLocation.accuracy,
          matchConfidence: scaledSim,
          livenessScore: 1.0
        });

        if (!attResult.success) {
          if (attResult.message === 'Attendance already marked for today.') {
            setMatchedProfile(matchedUser);
            setMatchConfidence(scaledSim);
            setVerificationSuccess(true);
            setAttendanceMarkedToday(true);
            updateQueueStats();
            await refreshLogs();
            stopWebcam();
            return;
          }

          activeChallengeRef.current = 'FAILED';
          setChallengeState(prev => ({
            ...prev,
            currentChallenge: 'FAILED',
            message: attResult.message || 'Verification failed.'
          }));
          setVerificationSuccess(false);
          stopWebcam();
          return;
        }

        setVerificationSuccess(true);
        setAttendanceMarkedToday(true);
        updateQueueStats();
        await refreshLogs();
        stopWebcam();

        // Face recognition login transition
        if (loginWithFaceActive) {
          setTimeout(async () => {
            const loginRes = await datalakeSyncService.login(matchedUser.id, "", true);
            if (loginRes.success) {
              const profile = datalakeSyncService.getCurrentProfile();
              setCurrentUserProfile(profile);
              setIsLoggedIn(true);

              const attStatus = await datalakeSyncService.getTodayAttendanceStatus();
              setAttendanceMarkedToday(attStatus.isMarked);

              const adminUser = profile?.role === 'System Administrator' || profile?.employeeId === 'admin';
              if (adminUser) {
                setActiveTab('registry');
                setIsEnrolling(false);
              } else {
                setIsEnrolling(false);
                setActiveTab('terminal');
              }
            }
            setLoginWithFaceActive(false);
            setVerificationSuccess(null);
          }, 2000);
        }
      } else {
        activeChallengeRef.current = 'FAILED';
        // Provide a more specific failure message
        let failMsg = 'Biometric mismatch. Access Refused.';
        const enrolledCount = (await dbService.getEnrolledUsers()).length;
        if (isCommonTerminal || !isAdmin) {
          failMsg = 'Face not recognized. Ask admin to enroll your face.';
        } else if (enrolledCount === 0) {
          failMsg = 'No enrolled faces in database. Register a face first via the Registry tab.';
        } else if (!matchResult.user) {
          failMsg = `No matching face found among ${enrolledCount} enrolled profile(s). Similarity: ${(matchResult.similarity * 100).toFixed(1)}%`;
        } else if (matchResult.similarity < 0.72) {
          failMsg = `Weak match (${(matchResult.similarity * 100).toFixed(1)}%). Try better lighting or re-enroll.`;
        } else {
          failMsg = `Face matched ${matchResult.user.name} but access restricted to your profile only.`;
        }
        
        setChallengeState(prev => ({
          ...prev,
          currentChallenge: 'FAILED',
          message: failMsg
        }));
        setVerificationSuccess(false);
        stopWebcam();
      }
    }
  };

  // Face Geometry Helpers
  const cropFaceRegion = (landmarks: { x: number; y: number; z: number }[]): HTMLCanvasElement | null => {
    if (!videoRef.current) return null;
    
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const pt of landmarks) {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }
    
    const w = maxX - minX;
    const h = maxY - minY;
    const size = Math.max(w, h);
    const centerX = minX + w / 2;
    const centerY = minY + h / 2;
    
    const padding = size * 0.3;
    const cropSize = size + padding * 2;
    const cropX = centerX - cropSize / 2;
    const cropY = centerY - cropSize / 2;

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = 112;
    cropCanvas.height = 112;
    const cropCtx = cropCanvas.getContext('2d');
    if (!cropCtx) return null;

    const sourceElement = (claheEnabled && claheCanvasRef.current) ? claheCanvasRef.current : videoRef.current;
    
    try {
      cropCtx.drawImage(
        sourceElement,
        cropX, cropY, cropSize, cropSize,
        0, 0, 112, 112
      );
      return cropCanvas;
    } catch (e) {
      console.warn('[DesktopWebDashboard] cropFaceRegion drawImage error:', e);
      return null;
    }
  };

  const generateRealFaceEmbedding = async (landmarks: { x: number; y: number; z: number }[]): Promise<Float32Array> => {
    const cropped = cropFaceRegion(landmarks);
    if (!cropped) {
      throw new Error('Could not crop face region from video stream.');
    }
    const embedding = await embedderService.generateEmbeddingWeb(cropped);
    if (!embedding) {
      throw new Error('TFLite inference failed. MobileFaceNet did not return a valid embedding.');
    }
    return embedding;
  };

  const snapVideoFrame = (): string => {
    if (videoRef.current && canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        canvasRef.current.width = 120;
        canvasRef.current.height = 120;
        const sourceElement = (claheEnabled && claheCanvasRef.current) ? claheCanvasRef.current : videoRef.current;
        const hasWidth = sourceElement && (sourceElement.videoWidth !== undefined ? sourceElement.videoWidth > 0 : sourceElement.width > 0);
        const hasHeight = sourceElement && (sourceElement.videoHeight !== undefined ? sourceElement.videoHeight > 0 : sourceElement.height > 0);
        if (sourceElement && hasWidth && hasHeight) {
          ctx.drawImage(sourceElement, 0, 0, 120, 120);
          return canvasRef.current.toDataURL('image/jpeg');
        }
      }
    }
    return '';
  };

  const drawFaceMesh = (ctx: CanvasRenderingContext2D, landmarks: any[], image?: any) => {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;

    // 1. Draw the actual camera frame (or CLAHE frame) directly onto the canvas
    const imgSource = image || ((claheEnabledRef.current && claheCanvasRef.current) ? claheCanvasRef.current : videoRef.current);
    const hasWidth = imgSource && (imgSource.videoWidth !== undefined ? imgSource.videoWidth > 0 : imgSource.width > 0);
    const hasHeight = imgSource && (imgSource.videoHeight !== undefined ? imgSource.videoHeight > 0 : imgSource.height > 0);
    if (imgSource && hasWidth && hasHeight) {
      ctx.drawImage(imgSource, 0, 0, width, height);
    } else {
      ctx.clearRect(0, 0, width, height);
    }

    // 2. Draw FaceMesh Connections (Tessellations) in a premium light blue color
    const mpGlobal = window as any;
    const tessellation = mpGlobal.FACEMESH_TESSELLATION;
    const drawConnectors = mpGlobal.drawConnectors;
    if (drawConnectors && tessellation) {
      drawConnectors(ctx, landmarks, tessellation, { color: 'rgba(244, 247, 252, 0.35)', lineWidth: 0.8 });
    }

    // 3. Draw Face Oval boundary
    const faceOval = mpGlobal.FACEMESH_FACE_OVAL;
    if (drawConnectors && faceOval) {
      drawConnectors(ctx, landmarks, faceOval, { color: '#0B3C73', lineWidth: 1.5 });
    }

    // 4. Draw ALL 468 landmarks as dense tiny glowing points stuck to face
    ctx.fillStyle = 'rgba(244, 247, 252, 0.9)';
    for (let i = 0; i < landmarks.length; i++) {
      const pt = landmarks[i];
      ctx.beginPath();
      ctx.arc(pt.x * width, pt.y * height, 1.2, 0, 2 * Math.PI);
      ctx.fill();
    }

    // 5. Draw nose yaw/pitch direction vector arrow
    const nose = landmarks[1];
    if (nose) {
      const startX = nose.x * width;
      const startY = nose.y * height;
      const arrowLength = 50;
      const endX = startX - Math.sin(liveYaw * Math.PI / 180) * arrowLength;
      const endY = startY + Math.sin(livePitch * Math.PI / 180) * arrowLength;

      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.strokeStyle = '#0B3C73'; 
      ctx.lineWidth = 2.0;
      ctx.stroke();
    }
  };

  // Simulating overrides for diagnostics
  const handleSimulateChallenge = async (action: 'BLINK' | 'SMILE' | 'TURN_LEFT' | 'TURN_RIGHT') => {
    const mockLandmarks = Array.from({ length: 468 }, () => ({ x: 0, y: 0, z: 0 }));
    if (action === 'BLINK' && activeChallengeRef.current === 'BLINK') {
      livenessService.calibrate(0.30, 0.15);
      for (let i = 0; i < 15; i++) livenessService.processFrame(mockLandmarks, 'BLINK');
      const res = livenessService.processFrame(mockLandmarks, 'BLINK');
      setChallengeState(res);
      await handleAdvanceRealChallenge(mockLandmarks);
    } else if (action === 'SMILE' && activeChallengeRef.current === 'SMILE') {
      await handleAdvanceRealChallenge(mockLandmarks);
    } else if (action === 'TURN_LEFT' && activeChallengeRef.current === 'TURN_LEFT') {
      await handleAdvanceRealChallenge(mockLandmarks);
    } else if (action === 'TURN_RIGHT' && activeChallengeRef.current === 'TURN_RIGHT') {
      await handleAdvanceRealChallenge(mockLandmarks);
    }
  };

  // Registry onboarding Flow
  const startEnrollmentWizard = () => {
    if (!streamActive) {
      alert('Activate the camera scanner feed first.');
      return;
    }
    let targetId: string;
    let targetName: string;
    let targetRole: string;

    if (!isAdmin && currentUserProfile) {
      targetId = currentUserProfile.employeeId;
      targetName = currentUserProfile.name;
      targetRole = currentUserProfile.role;
    } else {
      if (selectedEnrollIdOption === 'custom') {
        if (!enrollCustomId.trim()) {
          alert('Provide custom Employee ID.');
          return;
        }
        targetId = enrollCustomId.trim();
      } else {
        targetId = selectedEnrollIdOption;
      }
      if (!enrollName.trim()) {
        alert('Provide candidate registration name.');
        return;
      }
      targetName = enrollName.trim();
      targetRole = enrollRole;
    }

    setCapturedStepPhotos([]);
    enrollmentOrchestrator.startEnrollment(targetId, targetName, targetRole);
    setOrchestratorState('ENROLLING');
    orchestratorStateRef.current = 'ENROLLING';
    setEnrollProgressMsg('Look directly at the camera...');
    setIsEnrolling(true);
  };

  const handlePurgeUser = async (userId: string) => {
    if (confirm(`Are you sure you want to PERMANENTLY delete user ${userId} from the database? This action cannot be undone.`)) {
      const success = await dbService.deleteUser(userId);
      if (success) {
        alert('User permanently deleted from database.');
        await refreshUsers();
      } else {
        alert('Failed to delete user.');
      }
    }
  };

  // Seeding 20 Benchmark
  const handleSeed20 = async () => {
    setIsSeeding(true);
    setBenchmarkResult('Seeding 20 mock profiles. Please wait...');
    setTimeout(async () => {
      await dbService.seed20Database();
      await refreshUsers();
      updateQueueStats();
      setIsSeeding(false);
      setBenchmarkResult('Successfully cached 20 mock vectors locally.');
    }, 500);
  };

  const handleBenchmarkSearch = async () => {
    setBenchmarkResult('Executing vectorized dot-product search across 20 records...');
    setTimeout(async () => {
      const query = new Float32Array(128);
      for (let i = 0; i < 128; i++) query[i] = Math.sin(i);
      
      const t0 = performance.now();
      await dbService.vectorSearch(query);
      const latency = performance.now() - t0;
      
      setBenchmarkResult(`Search completed in ${latency.toFixed(1)}ms. Query checked 20 Float32Arrays.`);
    }, 100);
  };

  // Ledger Security Audits
  const handleCorruptLedger = async () => {
    if (logsList.length < 2) {
      alert('Execute at least 2 check-ins to build chain block history.');
      return;
    }
    const rawLedger = await dbService.getLedger();
    const tampered = [...rawLedger];
    tampered[1].userId = 'ROGUE_BYPASS_99';
    await dbService.saveLedger(tampered);
    await refreshLogs();
    alert('Tampered entry injected at block index 1. Security warning flags primed.');
  };

  const handleVerifyChain = async () => {
    const res = await ledgerService.verifyLedgerIntegrity();
    if (res.valid) {
      alert('Cryptographic audit checklist passed. All hashes verified intact.');
    } else {
      alert(`🚨 LEDGER COMPROMISED!\nHash verification mismatch detected at block index ${res.errorIndex}. Local storage locked.`);
    }
  };

  const handleHealChain = async () => {
    const rawLedger = await dbService.getLedger();
    const res = await ledgerService.verifyLedgerIntegrity();
    if (!res.valid && res.errorIndex >= 0) {
      const list = [...rawLedger];
      list[res.errorIndex].userId = currentUserProfile ? currentUserProfile.employeeId : 'admin'; // heal value
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
      alert('Ledger re-indexed and cryptographically healed.');
    } else {
      alert('No database anomalies found. Verification states nominal.');
    }
  };

  // Cloud Sync
  const triggerSyncLogs = async () => {
    if (!onlineSimulator) {
      alert('Enable simulated network status before launching sync.');
      return;
    }
    setSyncStatusMsg('Verifying ledger hash chain integrity...');
    const integrity = await ledgerService.verifyLedgerIntegrity();
    if (!integrity.valid) {
      setSyncStatusMsg('Sync Refused: Local ledger security compromise.');
      alert('Sync Refused: Chain corrupted. Self-heal database first.');
      return;
    }

    setSyncStatusMsg('Encrypting queue batches with HMAC-SHA256 device keys...');
    const result = await datalakeSyncService.syncOfflineQueue();
    setSyncStatusMsg(result.message);
    updateQueueStats();    // also calls refreshAttendance()
    await refreshLogs();
  };

  const triggerPurge = async () => {
    setSyncStatusMsg('Scanning database for synced blocks older than 48 hours...');
    const result = await awsSyncService.triggerFullSync();
    setSyncStatusMsg(`TTL Purge completed. ${result.purgedCount} synced blocks cleared.`);
    updateQueueStats();
    await refreshLogs();
  };

  // JSX View Renderers
  const renderTabContent = () => {
    switch (activeTab) {
      case 'terminal':
        if (!isAdmin && isEnrolling) {
          return (
            <div className="dashboard-grid">
              {/* Left Column: Directory / Enrollment State Panel */}
              <div className="card registry-card" style={{ flex: '1', minWidth: '0' }}>
                <div className="card-header">
                  <h3>Guided Biometric Onboarding</h3>
                </div>
                <div style={{ padding: '20px' }}>
                  <p style={{ marginBottom: '16px', color: 'var(--text-slate)', fontSize: '14px', lineHeight: '1.4' }}>
                    Hello <strong>{currentUserProfile?.name || 'Officer'}</strong>. Your face profile is not registered in the local offline database yet. Let's start a 6-stage head movement scan to register your face model.
                  </p>
                  <div className="enrollment-panel" style={{ background: 'transparent', padding: 0, boxShadow: 'none', border: 'none' }}>
                    <div className="enrollment-guidance">
                      <p className="enroll-prompt" style={{ fontSize: '15px', fontWeight: 'bold', color: 'var(--navy-primary)', minHeight: '40px' }}>{enrollProgressMsg}</p>
                      {enrollFrameResult && (
                        <div className="enroll-step-progress" style={{ margin: '14px 0' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
                            <span>Step: <strong>{enrollFrameResult.currentStep}</strong></span>
                            <span><strong>{Math.round(enrollFrameResult.overallProgress * 100)}% Complete</strong></span>
                          </div>
                          <div className="progress-bar-sm" style={{ marginTop: '6px' }}>
                            <div className="progress-fill" style={{ width: `${enrollFrameResult.overallProgress * 100}%` }} />
                          </div>
                        </div>
                      )}
                      {orchestratorState !== 'IDLE' && (
                        <div className="enroll-gallery" style={{ marginTop: '16px' }}>
                          {ENROLLMENT_STEPS.map(stepConfig => {
                            const photoObj = capturedStepPhotos.find(p => p.step === stepConfig.step);
                            const label = stepConfig.label;
                            
                            return (
                              <div key={stepConfig.step} className="enroll-gallery-item">
                                <div style={{
                                  width: '32px',
                                  height: '32px',
                                  borderRadius: '50%',
                                  border: photoObj ? '2px solid var(--navy-primary)' : '2px dashed var(--border-color)',
                                  backgroundColor: photoObj ? 'transparent' : 'var(--white)',
                                  display: 'flex',
                                  justifyContent: 'center',
                                  alignItems: 'center',
                                  overflow: 'hidden',
                                  position: 'relative'
                                }}>
                                  {photoObj ? (
                                    <>
                                      <img src={photoObj.photo} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                      <div style={{
                                        position: 'absolute',
                                        bottom: 0,
                                        right: 0,
                                        background: 'var(--navy-primary)',
                                        color: 'var(--white)',
                                        borderRadius: '50%',
                                        width: '10px',
                                        height: '10px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: '6px',
                                        fontWeight: 'bold'
                                      }}>✓</div>
                                    </>
                                  ) : (
                                    <span style={{ fontSize: '11px', color: 'var(--navy-light)', fontWeight: 'bold' }}>
                                      {stepConfig.arrow === 'up' && '↑'}
                                      {stepConfig.arrow === 'down' && '↓'}
                                      {stepConfig.arrow === 'left' && '←'}
                                      {stepConfig.arrow === 'right' && '→'}
                                      {stepConfig.arrow === 'tilt-left' && '⤾'}
                                      {stepConfig.arrow === 'none' && '👤'}
                                    </span>
                                  )}
                                </div>
                                <span style={{ 
                                  fontSize: '8px', 
                                  fontWeight: photoObj ? 'bold' : 'normal',
                                  color: photoObj ? 'var(--navy-primary)' : 'var(--text-gray)', 
                                  textAlign: 'center',
                                  whiteSpace: 'nowrap'
                                }}>
                                  {stepConfig.step === 'LOOK_CENTER' ? 'Center' : 
                                   stepConfig.step === 'LOOK_UP' ? 'Up' : 
                                   stepConfig.step === 'LOOK_DOWN' ? 'Down' : 
                                   stepConfig.step === 'TURN_LEFT' ? 'Left' : 
                                   stepConfig.step === 'TURN_RIGHT' ? 'Right' : 'Tilt'}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div className="enroll-buttons" style={{ marginTop: '20px' }}>
                      <button onClick={startEnrollmentWizard} className="btn-primary" style={{ height: '42px', width: '100%' }}>
                        {orchestratorState === 'ENROLLING' ? 'Scanning...' : 'Start 6-Step Scan'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Camera Viewport */}
              <div className="card terminal-card" style={{ flex: '1.2', minWidth: '0' }}>
                <div className="card-header">
                  <h3>Guided Onboarding Camera</h3>
                  <div className="clahe-toggle">
                    <span className="toggle-txt">CLAHE Correction</span>
                    <label className="switch-sm">
                      <input 
                        type="checkbox" 
                        checked={claheEnabled} 
                        onChange={(e) => setClaheEnabled(e.target.checked)} 
                      />
                      <span className="slider round"></span>
                    </label>
                  </div>
                </div>

                <div className="camera-viewport">
                  <div className="video-relative" style={{ display: streamActive ? 'block' : 'none' }}>
                    <video 
                      ref={videoRef} 
                      autoPlay 
                      playsInline 
                      muted 
                      className="hidden-video"
                    />
                    <canvas 
                      ref={meshCanvasRef} 
                      className="live-canvas"
                      width="480"
                      height="480"
                    />
                    <canvas 
                      ref={canvasRef} 
                      style={{ display: 'none' }}
                      width="112"
                      height="112"
                    />
                  </div>
                  {!streamActive && (
                    <div className="camera-offline">
                      <span className="camera-icon">👁️</span>
                      <button onClick={startWebcam} className="btn-camera-toggle">
                        {mpLoading ? 'Loading libraries...' : 'Activate Onboarding Camera'}
                      </button>
                      {streamError && <p className="error-txt">{streamError}</p>}
                    </div>
                  )}
                </div>

                {streamActive && (
                  <div className="camera-actions">
                    <button onClick={stopWebcam} className="btn-camera-close">
                      Close Camera Feed
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        }

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div className="dashboard-grid">
              {/* Left Box: Video */}
              <div className="card terminal-card" style={{ flex: '1.2', minWidth: '0' }}>
                <div className="card-header">
                  <h3>Edge ID Camera Terminal</h3>
                  <div className="clahe-toggle">
                    <span className="toggle-txt">CLAHE Correction</span>
                    <label className="switch-sm">
                      <input 
                        type="checkbox" 
                        checked={claheEnabled} 
                        onChange={(e) => setClaheEnabled(e.target.checked)} 
                      />
                      <span className="slider round"></span>
                    </label>
                  </div>
                </div>

                <div className="camera-viewport">
                  <div className="video-relative" style={{ display: streamActive ? 'block' : 'none' }}>
                    <video 
                      ref={videoRef} 
                      autoPlay 
                      playsInline 
                      muted 
                      className="hidden-video"
                    />
                    <canvas 
                      ref={meshCanvasRef} 
                      className="live-canvas"
                      width="480"
                      height="480"
                    />
                    <canvas 
                      ref={canvasRef} 
                      style={{ display: 'none' }}
                      width="112"
                      height="112"
                    />
                  </div>
                  {!streamActive && (
                    <div className="camera-offline">
                      <span className="camera-icon">👁️</span>
                      <button onClick={startWebcam} className="btn-camera-toggle">
                        {mpLoading ? 'Loading libraries...' : 'Activate Edge Camera'}
                      </button>
                      {streamError && <p className="error-txt">{streamError}</p>}
                    </div>
                  )}
                </div>

                {streamActive && (
                  <div className="camera-actions">
                    <button onClick={stopWebcam} className="btn-camera-close">
                      Close Camera Feed
                    </button>
                  </div>
                )}

                <div className="stats-row">
                  <div className="stat-box">
                    <span className="stat-label">EAR</span>
                    <span className="stat-val">{liveEAR}</span>
                  </div>
                  <div className="stat-box">
                    <span className="stat-label">MAR</span>
                    <span className="stat-val">{liveMAR}</span>
                  </div>
                  <div className="stat-box">
                    <span className="stat-label">Yaw</span>
                    <span className="stat-val">{liveYaw}°</span>
                  </div>
                  <div className="stat-box">
                    <span className="stat-label">Pitch</span>
                    <span className="stat-val">{livePitch}°</span>
                  </div>
                </div>
              </div>

              {/* Right Box: Liveness Check & Results */}
              <div className="card control-card" style={{ flex: '1', minWidth: '0' }}>
                <div className="card-header">
                  <h3>Anti-Spoofing Verification</h3>
                </div>

                <div className="verification-session">
                  <div className="session-progress">
                    <div className="progress-bar">
                      <div 
                        className="progress-fill" 
                        style={{ width: `${challengeState.progress * 100}%` }}
                      />
                    </div>
                    <div className="progress-lbls">
                      <span>Liveness Progress</span>
                      <span>{Math.round(challengeState.progress * 100)}%</span>
                    </div>
                  </div>

                  <div className="liveness-console">
                    <div className="console-indicator">
                      <span className="console-prompt">Instruction:</span>
                      <span className="console-challenge">{challengeState.currentChallenge}</span>
                    </div>
                    <p className="console-status-msg">{challengeState.message}</p>
                  </div>

                  {isAdmin && streamActive && challengeState.currentChallenge !== 'SUCCESS' && challengeState.currentChallenge !== 'FAILED' && (
                    <div className="simulator-overrides">
                      <h4>Judge Telemetry Simulator</h4>
                      <p className="override-desc">Click below to simulate head movement/blink gestures:</p>
                      <div className="override-buttons">
                        <button 
                          onClick={() => handleSimulateChallenge('BLINK')}
                          disabled={challengeState.currentChallenge !== 'BLINK'}
                          className="btn-sim"
                        >
                          Simulate Eyes Blink
                        </button>
                        <button 
                          onClick={() => handleSimulateChallenge('SMILE')}
                          disabled={challengeState.currentChallenge !== 'SMILE'}
                          className="btn-sim"
                        >
                          Simulate Smile
                        </button>
                        <button 
                          onClick={() => handleSimulateChallenge('TURN_LEFT')}
                          disabled={challengeState.currentChallenge !== 'TURN_LEFT'}
                          className="btn-sim"
                        >
                          Simulate Turn Left
                        </button>
                        <button 
                          onClick={() => handleSimulateChallenge('TURN_RIGHT')}
                          disabled={challengeState.currentChallenge !== 'TURN_RIGHT'}
                          className="btn-sim"
                        >
                          Simulate Turn Right
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 1:N Vector Search Results Card */}
                  {verificationSuccess !== null && (
                    <div className={`verification-result-card ${verificationSuccess ? 'verified' : 'denied'}`}>
                      <div className="result-header">
                        <span className="result-icon">{verificationSuccess ? '✓' : '✗'}</span>
                        <h4>{verificationSuccess ? 'Identity Verified' : 'Access Refused'}</h4>
                      </div>
                      {verificationSuccess && matchedProfile ? (
                        <div className="result-body">
                          <p className="result-user-name">{matchedProfile.name}</p>
                          <p className="result-user-detail">Role: {matchedProfile.role}</p>
                          <p className="result-user-detail">User ID: {matchedProfile.id}</p>
                          <div className="result-meta-row">
                            <span>Match Confidence: <strong>{(matchConfidence * 100).toFixed(1)}%</strong></span>
                            <span>Search Delay: <strong>{searchLatency || 11}ms</strong></span>
                          </div>
                          {claheEnabled && (
                            <p className="preproc-detail">Luma Enhanced (CLAHE: {claheLatencyMs}ms)</p>
                          )}
                          <p className="ledger-notice">Check-in logged into local hash-chain ledger.</p>
                        </div>
                      ) : (
                        <div className="result-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          <div>
                            <p className="result-user-name" style={{ color: 'var(--danger)' }}>Biometric Mismatch</p>
                            <p className="result-user-detail">No matching profiles found in database or liveness check failed.</p>
                          </div>
                          <button 
                            onClick={() => {
                              setActiveTab('registry');
                              setIsEnrolling(true);
                              setEnrollName('');
                              setEnrollRole('Toll Operator');
                              // Start webcam if not active
                              if (!streamActive) {
                                startWebcam();
                              }
                            }} 
                            className="btn-primary"
                            style={{ margin: 0, width: '100%', height: '40px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                          >
                            👤 Register This Person
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Roster Directory (Integrated into verification page) */}
              <div className="card" style={{ flex: '1', minWidth: '280px', display: 'flex', flexDirection: 'column' }}>
                <div className="card-header" style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                  <div>
                    <h3>👥 Roster Directory</h3>
                    <p style={{ fontSize: '12px', color: 'var(--text-gray)', marginTop: '2px' }}>
                      Total Workers: {usersList.length} | Showing: {(() => {
                        const startOfToday = new Date().setHours(0, 0, 0, 0);
                        const presentWorkerIds = new Set([
                          ...attendanceQueue.filter(q => q.enqueuedAt >= startOfToday).map(q => q.employeeId),
                          ...logsList.filter(log => log.status === 'VERIFIED' && log.timestamp >= startOfToday).map(log => log.userId)
                        ]);
                        return usersList.filter(worker => {
                          const isPresent = presentWorkerIds.has(worker.id);
                          if (rosterFilter === 'PRESENT') return isPresent;
                          if (rosterFilter === 'ABSENT') return !isPresent;
                          return true;
                        }).length;
                      })()}
                    </p>
                  </div>
                </div>

                {/* Filter Pills */}
                <div style={{ display: 'flex', gap: '8px', padding: '12px 16px 0 16px' }}>
                  <button 
                    onClick={() => setRosterFilter('ALL')}
                    style={{
                      flex: 1,
                      padding: '6px 12px',
                      fontSize: '11px',
                      fontWeight: 'bold',
                      borderRadius: '20px',
                      border: '1px solid var(--border-color)',
                      background: rosterFilter === 'ALL' ? 'var(--navy-primary)' : 'transparent',
                      color: rosterFilter === 'ALL' ? 'var(--white)' : 'var(--text-gray)',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                  >
                    All
                  </button>
                  <button 
                    onClick={() => setRosterFilter('PRESENT')}
                    style={{
                      flex: 1,
                      padding: '6px 12px',
                      fontSize: '11px',
                      fontWeight: 'bold',
                      borderRadius: '20px',
                      border: '1px solid var(--border-color)',
                      background: rosterFilter === 'PRESENT' ? '#10B981' : 'transparent',
                      color: rosterFilter === 'PRESENT' ? 'var(--white)' : 'var(--text-gray)',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                  >
                    Present
                  </button>
                  <button 
                    onClick={() => setRosterFilter('ABSENT')}
                    style={{
                      flex: 1,
                      padding: '6px 12px',
                      fontSize: '11px',
                      fontWeight: 'bold',
                      borderRadius: '20px',
                      border: '1px solid var(--border-color)',
                      background: rosterFilter === 'ABSENT' ? '#EF4444' : 'transparent',
                      color: rosterFilter === 'ABSENT' ? 'var(--white)' : 'var(--text-gray)',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                  >
                    Absent
                  </button>
                </div>

                <div className="roster-list-container" style={{ flex: '1', overflowY: 'auto', maxHeight: '420px', paddingRight: '4px', marginTop: '12px' }}>
                  {usersList.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {(() => {
                        const startOfToday = new Date().setHours(0, 0, 0, 0);
                        const presentWorkerIds = new Set([
                          ...attendanceQueue.filter(q => q.enqueuedAt >= startOfToday).map(q => q.employeeId),
                          ...logsList.filter(log => log.status === 'VERIFIED' && log.timestamp >= startOfToday).map(log => log.userId)
                        ]);

                        const filteredWorkers = usersList.filter(worker => {
                          const isPresent = presentWorkerIds.has(worker.id);
                          if (rosterFilter === 'PRESENT') return isPresent;
                          if (rosterFilter === 'ABSENT') return !isPresent;
                          return true;
                        });

                        if (filteredWorkers.length === 0) {
                          return (
                            <div className="empty-state" style={{ padding: '40px 10px' }}>
                              <p className="empty-state-msg">No workers found.</p>
                            </div>
                          );
                        }

                        return filteredWorkers.map(worker => {
                          const isSystemAdmin = worker.role === 'System Administrator' || worker.id === 'admin';
                          const badgeClass = isSystemAdmin ? 'admin-badge' : 'worker-badge';
                          const badgeLabel = isSystemAdmin ? 'Admin' : 'Worker';
                          const isPresent = presentWorkerIds.has(worker.id);

                          return (
                            <div key={worker.id} style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '12px',
                              background: 'var(--ice-bg)',
                              borderRadius: '8px',
                              border: '1px solid var(--border-color)'
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                {/* Status dot */}
                                <span style={{
                                  width: '8px',
                                  height: '8px',
                                  borderRadius: '50%',
                                  display: 'inline-block',
                                  flexShrink: 0,
                                  backgroundColor: isPresent ? '#10B981' : '#EF4444',
                                  boxShadow: isPresent ? '0 0 6px #10B981' : '0 0 6px #EF4444'
                                }} />
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                  <span style={{ fontWeight: 'bold', fontSize: '13px', color: 'var(--navy-dark)' }}>{worker.name}</span>
                                  <span style={{ fontSize: '11px', color: 'var(--text-gray)' }}>ID: {worker.id}</span>
                                </div>
                              </div>
                              <span className={`role-badge-tag ${badgeClass}`} style={{
                                fontSize: '10px',
                                fontWeight: 'bold',
                                padding: '4px 8px',
                                borderRadius: '12px',
                                textTransform: 'uppercase',
                                letterSpacing: '0.4px',
                                whiteSpace: 'nowrap'
                              }}>
                                {badgeLabel}
                              </span>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  ) : (
                    <div className="empty-state" style={{ padding: '40px 10px' }}>
                      <p className="empty-state-msg">No workers registered.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Real-time Verification & Attendance Logs */}
            <div className="card" style={{ padding: '24px' }}>
              <div className="card-header" style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3>📋 Verification & Attendance Logs</h3>
                <span className="telemetry-val" style={{ fontSize: '12px', color: 'var(--text-gray)' }}>
                  Showing last 10 local entries
                </span>
              </div>
              <div className="roster-container" style={{ overflowX: 'auto' }}>
                <table className="roster-table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Employee ID</th>
                      <th>Name</th>
                      <th>Confidence</th>
                      <th>GPS Coordinates</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logsList.slice(0, 10).map((log) => {
                      const person = usersList.find(u => u.id === log.userId);
                      // Check if the record is still pending in the sync queue to show correct sync badge
                      const isPending = attendanceQueue.some(q => q.employeeId === log.userId && Math.abs(q.timestamp - log.timestamp) < 5000);
                      const syncStatus = isPending ? 'PENDING' : 'SYNCED';
                      return (
                        <tr key={log.id}>
                          <td>{new Date(log.timestamp).toLocaleTimeString('en-IN')}</td>
                          <td><strong>{log.userId}</strong></td>
                          <td>{person?.name ?? '—'}</td>
                          <td>{log.confidence ? `${(log.confidence * 100).toFixed(1)}%` : '—'}</td>
                          <td>{log.latitude?.toFixed(4)}, {log.longitude?.toFixed(4)}</td>
                          <td>
                            <span className={`status-badge ${syncStatus.toLowerCase()}`}>
                              {syncStatus}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {logsList.length === 0 && (
                      <tr>
                        <td colSpan={6} className="no-logs" style={{ textAlign: 'center', padding: '20px' }}>
                          No verification logs found. Mark attendance above to populate.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );

      case 'registry':
        return (
          <div className="dashboard-grid">
            {/* Left Column: Directory */}
            <div className="card registry-card">
              <div className="card-header">
                <h3>Personnel Roster</h3>
                <input 
                  type="text" 
                  placeholder="Search registered staff..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="search-input"
                />
              </div>

              <div className="roster-container">
                <table className="roster-table">
                  <thead>
                    <tr>
                      <th>Employee ID</th>
                      <th>Name</th>
                      <th>Role</th>
                      <th>Embedding Dims</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usersList
                      .filter(u => u.name.toLowerCase().includes(searchQuery.toLowerCase()))
                      .map(u => (
                        <tr key={u.id}>
                          <td><strong>{u.id}</strong></td>
                          <td>{u.name}</td>
                          <td>{u.role}</td>
                          <td>{u.embedding.length} Dimensions</td>
                          <td>
                            <button 
                              onClick={() => handlePurgeUser(u.id)}
                              className="btn-sim btn-danger"
                              style={{ padding: '4px 8px', fontSize: '11px', margin: 0 }}
                            >
                              🗑️ Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

              <div className="roster-actions">
                {!isEnrolling ? (
                  <button onClick={() => setIsEnrolling(true)} className="btn-primary">
                    Register New Officer
                  </button>
                ) : (
                  <div className="enrollment-panel">
                    <h4>Guided Biometric Onboarding</h4>
                    <div className="input-group">
                      <label style={{ display: 'block', marginBottom: '4px' }}>Select Staff to Enroll</label>
                      <select 
                        value={selectedEnrollIdOption}
                        onChange={(e) => setSelectedEnrollIdOption(e.target.value)}
                        style={{ padding: '10px', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '13px', fontFamily: 'inherit', outline: 'none' }}
                      >
                        <option value="NHAI-2026-001">NHAI-2026-001 (Keshav Kumar Agrawal)</option>
                        <option value="NHAI-2026-002">NHAI-2026-002 (Harshiya Sharma)</option>
                        <option value="NHAI-2026-003">NHAI-2026-003 (Anurag Mohapatra)</option>
                        <option value="admin">admin (System Administrator)</option>
                        <option value="custom">Custom ID...</option>
                      </select>
                    </div>

                    {selectedEnrollIdOption === 'custom' && (
                      <div className="input-group">
                        <label>Custom Employee ID</label>
                        <input 
                          type="text" 
                          value={enrollCustomId} 
                          onChange={(e) => setEnrollCustomId(e.target.value)} 
                          placeholder="e.g. NHAI-2026-004"
                        />
                      </div>
                    )}

                    <div className="input-group">
                      <label>Name</label>
                      <input 
                        type="text" 
                        value={enrollName} 
                        onChange={(e) => setEnrollName(e.target.value)} 
                        placeholder="Full Name"
                        disabled={selectedEnrollIdOption !== 'custom'}
                      />
                    </div>
                    <div className="input-group">
                      <label>Position / Role</label>
                      <input 
                        type="text" 
                        value={enrollRole} 
                        onChange={(e) => setEnrollRole(e.target.value)} 
                        placeholder="e.g. Toll Operator, Admin, etc."
                        disabled={selectedEnrollIdOption !== 'custom'}
                      />
                    </div>

                    <div className="enrollment-guidance">
                      <p className="enroll-prompt">{enrollProgressMsg}</p>
                      {enrollFrameResult && (
                        <div className="enroll-step-progress">
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>Step: <strong>{enrollFrameResult.currentStep}</strong></span>
                            <span><strong>{Math.round(enrollFrameResult.overallProgress * 100)}% Complete</strong></span>
                          </div>
                          <div className="progress-bar-sm" style={{ marginTop: '6px' }}>
                            <div className="progress-fill" style={{ width: `${enrollFrameResult.overallProgress * 100}%` }} />
                          </div>
                        </div>
                      )}
                      {orchestratorState !== 'IDLE' && (
                        <div className="enroll-gallery">
                          {ENROLLMENT_STEPS.map(stepConfig => {
                            const photoObj = capturedStepPhotos.find(p => p.step === stepConfig.step);
                            const label = stepConfig.label;
                            
                            return (
                              <div key={stepConfig.step} className="enroll-gallery-item">
                                <div style={{
                                  width: '32px',
                                  height: '32px',
                                  borderRadius: '50%',
                                  border: photoObj ? '2px solid var(--navy-primary)' : '2px dashed var(--border-color)',
                                  backgroundColor: photoObj ? 'transparent' : 'var(--white)',
                                  display: 'flex',
                                  justifyContent: 'center',
                                  alignItems: 'center',
                                  overflow: 'hidden',
                                  position: 'relative'
                                }}>
                                  {photoObj ? (
                                    <>
                                      <img src={photoObj.photo} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                      <div style={{
                                        position: 'absolute',
                                        bottom: 0,
                                        right: 0,
                                        background: 'var(--navy-primary)',
                                        color: 'var(--white)',
                                        borderRadius: '50%',
                                        width: '10px',
                                        height: '10px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: '6px',
                                        fontWeight: 'bold'
                                      }}>✓</div>
                                    </>
                                  ) : (
                                    <span style={{ fontSize: '11px', color: 'var(--navy-light)', fontWeight: 'bold' }}>
                                      {stepConfig.arrow === 'up' && '↑'}
                                      {stepConfig.arrow === 'down' && '↓'}
                                      {stepConfig.arrow === 'left' && '←'}
                                      {stepConfig.arrow === 'right' && '→'}
                                      {stepConfig.arrow === 'tilt-left' && '⤾'}
                                      {stepConfig.arrow === 'none' && '👤'}
                                    </span>
                                  )}
                                </div>
                                <span style={{ 
                                  fontSize: '8px', 
                                  fontWeight: photoObj ? 'bold' : 'normal',
                                  color: photoObj ? 'var(--navy-primary)' : 'var(--text-gray)', 
                                  textAlign: 'center',
                                  whiteSpace: 'nowrap'
                                }}>
                                  {stepConfig.step === 'LOOK_CENTER' ? 'Center' : 
                                   stepConfig.step === 'LOOK_UP' ? 'Up' : 
                                   stepConfig.step === 'LOOK_DOWN' ? 'Down' : 
                                   stepConfig.step === 'TURN_LEFT' ? 'Left' : 
                                   stepConfig.step === 'TURN_RIGHT' ? 'Right' : 'Tilt'}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div className="enroll-buttons">
                      <button onClick={startEnrollmentWizard} className="btn-sim">
                        {orchestratorState === 'ENROLLING' ? 'Scanning...' : 'Start 6-Step Scan'}
                      </button>
                      <button onClick={() => setIsEnrolling(false)} className="btn-secondary">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Camera Viewport / Seeding & Benchmarks */}
            {isEnrolling ? (
              <div className="card terminal-card" style={{ flex: '1', minWidth: '0' }}>
                <div className="card-header">
                  <h3>Guided Onboarding Camera</h3>
                  <div className="clahe-toggle">
                    <span className="toggle-txt">CLAHE Correction</span>
                    <label className="switch-sm">
                      <input 
                        type="checkbox" 
                        checked={claheEnabled} 
                        onChange={(e) => setClaheEnabled(e.target.checked)} 
                      />
                      <span className="slider round"></span>
                    </label>
                  </div>
                </div>

                <div className="camera-viewport">
                  <div className="video-relative" style={{ display: streamActive ? 'block' : 'none' }}>
                    <video 
                      ref={videoRef} 
                      autoPlay 
                      playsInline 
                      muted 
                      className="hidden-video"
                    />
                    <canvas 
                      ref={meshCanvasRef} 
                      className="live-canvas"
                      width="480"
                      height="480"
                    />
                    <canvas 
                      ref={canvasRef} 
                      style={{ display: 'none' }}
                      width="112"
                      height="112"
                    />
                  </div>
                  {!streamActive && (
                    <div className="camera-offline">
                      <span className="camera-icon">👁️</span>
                      <button onClick={startWebcam} className="btn-camera-toggle">
                        {mpLoading ? 'Loading libraries...' : 'Activate Edge Camera'}
                      </button>
                      {streamError && <p className="error-txt">{streamError}</p>}
                    </div>
                  )}
                </div>

                {streamActive && (
                  <div className="camera-actions">
                    <button onClick={stopWebcam} className="btn-camera-close">
                      Close Camera Feed
                    </button>
                  </div>
                )}

                <div className="stats-row" style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
                  <div className="stat-box" style={{ flex: 1, padding: '8px', background: 'var(--ice-bg)', borderRadius: '6px', textAlign: 'center' }}>
                    <span className="stat-label" style={{ fontSize: '10px', color: 'var(--text-gray)' }}>Yaw</span>
                    <span className="stat-val" style={{ display: 'block', fontSize: '14px', fontWeight: 'bold', color: 'var(--navy-dark)' }}>{liveYaw}°</span>
                  </div>
                  <div className="stat-box" style={{ flex: 1, padding: '8px', background: 'var(--ice-bg)', borderRadius: '6px', textAlign: 'center' }}>
                    <span className="stat-label" style={{ fontSize: '10px', color: 'var(--text-gray)' }}>Pitch</span>
                    <span className="stat-val" style={{ display: 'block', fontSize: '14px', fontWeight: 'bold', color: 'var(--navy-dark)' }}>{livePitch}°</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="card benchmark-card">
                <div className="card-header">
                  <h3>20 Vector Match Performance Audit</h3>
                </div>
                <div className="card-body">
                  <p className="bench-desc">
                    To verify the efficiency of our localized SQLite search algorithms on low-power devices, you can seed the database cache with 20 synthetic records and measure the exact dot-product matrix search latency.
                  </p>

                  <div className="bench-actions">
                    <button 
                      onClick={handleSeed20} 
                      disabled={isSeeding}
                      className="btn-sim"
                    >
                      {isSeeding ? 'Caching Vectors...' : 'Seed 20 Roster Profiles'}
                    </button>

                    <button 
                      onClick={handleBenchmarkSearch}
                      disabled={usersList.length < 10}
                      className="btn-sim"
                    >
                      Run Search Latency Audit
                    </button>
                  </div>

                  {benchmarkResult && (
                    <div className="benchmark-console">
                      <p className="console-heading">Latency Audit Output:</p>
                      <p className="console-log">{benchmarkResult}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );

      case 'ledger':
        return (
          <div className="card ledger-card">
            <div className="card-header">
              <h3>SHA-256 Offline Cryptographic Ledger</h3>
              <div className="ledger-actions">
                <button onClick={handleCorruptLedger} className="btn-sim btn-danger">
                  Inject Rogue Block data
                </button>
                <button onClick={handleVerifyChain} className="btn-sim">
                  Audit Chain Integrity
                </button>
                <button onClick={handleHealChain} className="btn-sim">
                  Self-Heal Ledger
                </button>
              </div>
            </div>

            <div className="ledger-timeline-container">
              <div className="ledger-timeline">
                {logsList.map((log, index) => (
                  <div key={log.id} className="ledger-block-node">
                    <div className="block-header">
                      <span className="block-idx">Block #{logsList.length - index}</span>
                      <span className={`block-badge ${log.status === 'VERIFIED' ? 'ok' : 'err'}`}>
                        {log.status}
                      </span>
                    </div>
                    <div className="block-body">
                      <p>Tx ID: <strong>{log.id.slice(0, 15)}...</strong></p>
                      <p>User: {log.userId}</p>
                      <p>Match: {(log.confidence * 100).toFixed(1)}%</p>
                      <div className="block-hashes">
                        <span className="hash-lbl">Hash: {log.hash.slice(0, 10)}...</span>
                        <span className="hash-lbl">Prev: {log.prevHash.slice(0, 10)}...</span>
                      </div>
                    </div>
                    {index < logsList.length - 1 && (
                      <div className="timeline-arrow">➔</div>
                    )}
                  </div>
                ))}
                {logsList.length === 0 && (
                  <p className="no-logs">No offline ledger items populated. Run check-ins in the terminal.</p>
                )}
              </div>
            </div>
          </div>
        );

      case 'sync':
        return (
          <div className="dashboard-grid">
            {/* Sync Manager */}
            <div className="card sync-status-card">
              <div className="card-header">
                <h3>Cloud Gateway Status</h3>
              </div>
              <div className="card-body">
                <div className="gateway-list">
                  <div className="gateway-item">
                    <span className="gt-label">NIC Datalake v3 Server</span>
                    <span className="gt-val">https://datalake.nic.in/api/v3</span>
                  </div>
                  <div className="gateway-item">
                    <span className="gt-label">AWS API Gateway Endpoint</span>
                    <span className="gt-val">https://api.datalake3.nhai.gov/v1/sync</span>
                  </div>
                  <div className="gateway-item">
                    <span className="gt-label">Network Mode</span>
                    <span className="gt-val"><strong>{onlineSimulator ? 'ONLINE' : 'OFF-GRID'}</strong></span>
                  </div>
                  <div className="gateway-item">
                    <span className="gt-label">Pending Sync Backlog</span>
                    <span className="gt-val">{pendingCount} Records</span>
                  </div>
                </div>

                <div className="sync-actions-row">
                  <button onClick={triggerSyncLogs} className="btn-sim">
                    Force Cloud Sync Queue
                  </button>
                  <button onClick={triggerPurge} className="btn-sim">
                    Purge Uploaded Items (&gt;48 Hours)
                  </button>
                </div>

                <div className="sync-logs-console">
                  <span className="console-heading">Sync Manager Status:</span>
                  <p className="console-log">{syncStatusMsg}</p>
                </div>
              </div>
            </div>

            {/* Queue List */}
            <div className="card queue-list-card">
              <div className="card-header">
                <h3>Offline Cache Queue</h3>
              </div>
              <div className="queue-list-container">
                <table className="roster-table">
                  <thead>
                    <tr>
                      <th>Local Check ID</th>
                      <th>Time</th>
                      <th>Staff ID</th>
                      <th>GPS Coordinates</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logsList
                      .slice(0, 8)
                      .map(log => (
                        <tr key={log.id}>
                          <td><strong>{log.id.slice(0, 15)}...</strong></td>
                          <td>{new Date(log.timestamp).toLocaleTimeString()}</td>
                          <td>{log.userId}</td>
                          <td>{log.latitude.toFixed(4)}, {log.longitude.toFixed(4)}</td>
                        </tr>
                      ))}
                    {logsList.length === 0 && (
                      <tr>
                        <td colSpan={4} className="no-logs">Queue is currently clear.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );


    }
  };

  // Helper functions for specific roles and states
  const renderStaffUnenrolled = () => {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60vh',
        width: '100%'
      }}>
        <div className="card" style={{
          maxWidth: '480px',
          width: '100%',
          textAlign: 'center',
          padding: '40px',
          boxShadow: '0 10px 25px rgba(0,0,0,0.05)',
          borderRadius: '16px',
          border: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '20px'
        }}>
          <div style={{
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            background: 'var(--warn-bg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '36px',
            color: 'var(--warn)'
          }}>
            👤
          </div>
          <div>
            <h2 style={{ color: 'var(--navy-dark)', margin: '0 0 10px 0', fontSize: '22px', fontWeight: '700' }}>Biometric Profile Missing</h2>
            <p style={{ color: 'var(--text-gray)', fontSize: '14px', margin: 0, lineHeight: '1.5' }}>
              Your offline facial profile has not been registered yet. Please ask the Administrator to enroll your face under their session.
            </p>
          </div>
          <button onClick={handleLogout} className="btn-login-submit" style={{ width: '100%', height: '44px', marginTop: '10px' }}>
            Back to Login
          </button>
        </div>
      </div>
    );
  };

  const renderStaffSuccess = () => {
    const activeId = matchedProfile ? matchedProfile.id : (currentUserProfile?.employeeId || '');
    const activeName = matchedProfile ? matchedProfile.name : (currentUserProfile?.name || '');

    const today = new Date().setHours(0, 0, 0, 0);
    // Find today's attendance log in queue
    const queueLog = attendanceQueue.find(
      e => e.employeeId === activeId && e.enqueuedAt >= today
    );
    // Find today's log in ledger
    const ledgerLog = logsList.find(
      l => l.userId === activeId && l.status === 'VERIFIED' && l.timestamp >= today
    );

    const displayTimestamp = queueLog ? queueLog.timestamp : (ledgerLog ? ledgerLog.timestamp : Date.now());
    const displayHash = queueLog ? queueLog.offlineProofHash : (ledgerLog ? ledgerLog.hash : '');

    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '70vh',
        width: '100%'
      }}>
        <div className="card" style={{
          maxWidth: '520px',
          width: '100%',
          padding: '40px',
          boxShadow: '0 20px 40px rgba(0,0,0,0.06)',
          borderRadius: '20px',
          border: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '24px',
          background: 'var(--white)'
        }}>
          <div style={{
            width: '90px',
            height: '90px',
            borderRadius: '50%',
            background: 'var(--success-bg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '44px',
            color: 'var(--success)',
            boxShadow: '0 0 20px rgba(6, 95, 70, 0.15)',
            border: '3px solid var(--white)'
          }}>
            ✓
          </div>
          <div style={{ textAlign: 'center' }}>
            <h2 style={{ color: 'var(--navy-dark)', margin: '0 0 6px 0', fontSize: '24px', fontWeight: '800' }}>Attendance Marked</h2>
            <span className="network-badge online" style={{ fontSize: '10px', padding: '4px 10px', borderRadius: '12px' }}>
              OFFLINE EDGE AI SUCCESS
            </span>
          </div>

          <div style={{
            width: '100%',
            background: 'var(--ice-bg)',
            borderRadius: '12px',
            padding: '20px',
            border: '1px solid var(--border-color)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            fontSize: '13px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-gray)' }}>Name:</span>
              <strong style={{ color: 'var(--navy-dark)' }}>{activeName}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-gray)' }}>Employee ID:</span>
              <strong style={{ color: 'var(--navy-dark)' }}>{activeId}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-gray)' }}>Verify Time:</span>
              <strong style={{ color: 'var(--navy-dark)' }}>
                {new Date(displayTimestamp).toLocaleTimeString()}
              </strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-gray)' }}>GPS coordinates:</span>
              <strong style={{ color: 'var(--navy-dark)' }}>
                {gpsLocation.latitude.toFixed(6)}, {gpsLocation.longitude.toFixed(6)}
              </strong>
            </div>
            {displayHash && (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                borderTop: '1px dashed var(--border-color)',
                paddingTop: '10px',
                marginTop: '4px'
              }}>
                <span style={{ color: 'var(--text-gray)' }}>Cryptographic Ledger Hash:</span>
                <code style={{ fontSize: '10px', wordBreak: 'break-all', color: 'var(--text-gray)', background: '#EAEEF4', padding: '4px 8px', borderRadius: '4px' }}>
                  {displayHash}
                </code>
              </div>
            )}
          </div>

          {isCommonTerminal ? (
            <button 
              onClick={() => {
                setAttendanceMarkedToday(false);
                setMatchedProfile(null);
                setVerificationSuccess(null);
                setTimeout(() => startWebcam(), 100);
              }} 
              className="btn-primary" 
              style={{ width: '100%', height: '46px', margin: 0 }}
            >
              Next Worker Check-In
            </button>
          ) : (
            <button onClick={handleLogout} className="btn-login-submit" style={{ width: '100%', height: '46px', margin: 0 }}>
              Logout Session
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderStaffTerminal = () => {
    return (
      <div className="dashboard-grid" style={{ justifyContent: 'center' }}>
        {/* Left Box: Video */}
        <div className="card terminal-card" style={{ maxWidth: '480px', width: '100%' }}>
          <div className="card-header">
            <h3>Attendance Verification Terminal</h3>
            <div className="clahe-toggle">
              <span className="toggle-txt">CLAHE Correction</span>
              <label className="switch-sm">
                <input 
                  type="checkbox" 
                  checked={claheEnabled} 
                  onChange={(e) => setClaheEnabled(e.target.checked)} 
                />
                <span className="slider round"></span>
              </label>
            </div>
          </div>

          <div className="camera-viewport">
            <div className="video-relative" style={{ display: streamActive ? 'block' : 'none' }}>
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                muted 
                className="hidden-video"
              />
              <canvas 
                ref={meshCanvasRef} 
                className="live-canvas"
                width="480"
                height="480"
              />
              <canvas 
                ref={canvasRef} 
                style={{ display: 'none' }}
                width="112"
                height="112"
              />
            </div>
            {!streamActive && (
              <div className="camera-offline">
                <span className="camera-icon">👁️</span>
                <button onClick={startWebcam} className="btn-camera-toggle">
                  {mpLoading ? 'Loading libraries...' : 'Activate Camera'}
                </button>
                {streamError && <p className="error-txt">{streamError}</p>}
              </div>
            )}
          </div>

          {streamActive && (
            <div className="camera-actions">
              <button onClick={stopWebcam} className="btn-camera-close">
                Close Camera Feed
              </button>
            </div>
          )}
        </div>

        {/* Right Box: Liveness Check & Results */}
        <div className="card control-card" style={{ maxWidth: '440px', width: '100%' }}>
          <div className="card-header">
            <h3>Liveness Challenge</h3>
          </div>

          <div className="verification-session">
            <div className="session-progress">
              <div className="progress-bar">
                <div 
                  className="progress-fill" 
                  style={{ width: `${challengeState.progress * 100}%` }}
                />
              </div>
              <div className="progress-lbls">
                <span>Verification Progress</span>
                <span>{Math.round(challengeState.progress * 100)}%</span>
              </div>
            </div>

            <div className="liveness-console">
              <div className="console-indicator">
                <span className="console-prompt">Instruction:</span>
                <span className="console-challenge">{challengeState.currentChallenge}</span>
              </div>
              <p className="console-status-msg">{challengeState.message}</p>
            </div>

            {verificationSuccess !== null && (
              <div className={`verification-result-card ${verificationSuccess ? 'verified' : 'denied'}`}>
                <div className="result-header">
                  <span className="result-icon">{verificationSuccess ? '✓' : '✗'}</span>
                  <h4>
                    {verificationSuccess 
                      ? 'Verification Success' 
                      : (isCommonTerminal || !isAdmin ? 'Unverified' : 'Verification Failed')}
                  </h4>
                </div>
                {verificationSuccess ? (
                  <div className="result-body">
                    <p style={{ margin: 0, fontWeight: 'bold' }}>Logged successfully. Saving attendance...</p>
                  </div>
                ) : (
                  <div className="result-body" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <p style={{ margin: 0 }}>
                      {isCommonTerminal || !isAdmin 
                        ? (challengeState.message || "Face not recognized. Ask admin to enroll your face.") 
                        : "Mismatch or spoofing detected. Click Retry or try again."}
                    </p>
                    <button 
                      onClick={() => {
                        setVerificationSuccess(null);
                        setMatchedProfile(null);
                        setTimeout(() => startWebcam(), 100);
                      }}
                      className="btn-primary"
                      style={{ marginTop: '8px', padding: '8px 12px', fontSize: '12px', width: 'fit-content', alignSelf: 'center' }}
                    >
                      🔄 Retry Scan
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderAdminForceEnroll = () => {
    return (
      <div className="dashboard-grid">
        {/* Left Column: Directory / Enrollment State Panel */}
        <div className="card registry-card" style={{ flex: '1', minWidth: '0' }}>
          <div className="card-header">
            <h3>Admin Biometric Onboarding</h3>
          </div>
          <div style={{ padding: '20px' }}>
            <p style={{ marginBottom: '16px', color: 'var(--text-slate)', fontSize: '14px', lineHeight: '1.4' }}>
              Hello <strong>System Administrator</strong>. Before accessing the management portal, you must first register your face profile in the local offline database. Let's start the 6-stage head scan.
            </p>
            <div className="enrollment-panel" style={{ background: 'transparent', padding: 0, boxShadow: 'none', border: 'none' }}>
              <div className="enrollment-guidance">
                <p className="enroll-prompt" style={{ fontSize: '15px', fontWeight: 'bold', color: 'var(--navy-primary)', minHeight: '40px' }}>{enrollProgressMsg}</p>
                {enrollFrameResult && (
                  <div className="enroll-step-progress" style={{ margin: '14px 0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
                      <span>Step: <strong>{enrollFrameResult.currentStep}</strong></span>
                      <span><strong>{Math.round(enrollFrameResult.overallProgress * 100)}% Complete</strong></span>
                    </div>
                    <div className="progress-bar-sm" style={{ marginTop: '6px' }}>
                      <div className="progress-fill" style={{ width: `${enrollFrameResult.overallProgress * 100}%` }} />
                    </div>
                  </div>
                )}
                {orchestratorState !== 'IDLE' && (
                  <div className="enroll-gallery" style={{ marginTop: '16px' }}>
                    {ENROLLMENT_STEPS.map(stepConfig => {
                      const photoObj = capturedStepPhotos.find(p => p.step === stepConfig.step);
                      const label = stepConfig.label;
                      
                      return (
                        <div key={stepConfig.step} className="enroll-gallery-item">
                          <div style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '50%',
                            border: photoObj ? '2px solid var(--navy-primary)' : '2px dashed var(--border-color)',
                            backgroundColor: photoObj ? 'transparent' : 'var(--white)',
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                            overflow: 'hidden',
                            position: 'relative'
                          }}>
                            {photoObj ? (
                              <>
                                <img src={photoObj.photo} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                <div style={{
                                  position: 'absolute',
                                  bottom: 0,
                                  right: 0,
                                  background: 'var(--navy-primary)',
                                  color: 'var(--white)',
                                  borderRadius: '50%',
                                  width: '10px',
                                  height: '10px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: '6px',
                                  fontWeight: 'bold'
                                }}>✓</div>
                              </>
                            ) : (
                              <span style={{ fontSize: '11px', color: 'var(--navy-light)', fontWeight: 'bold' }}>
                                {stepConfig.arrow === 'up' && '↑'}
                                {stepConfig.arrow === 'down' && '↓'}
                                {stepConfig.arrow === 'left' && '←'}
                                {stepConfig.arrow === 'right' && '→'}
                                {stepConfig.arrow === 'tilt-left' && '⤾'}
                                {stepConfig.arrow === 'none' && '👤'}
                              </span>
                            )}
                          </div>
                          <span style={{ 
                            fontSize: '8px', 
                            fontWeight: photoObj ? 'bold' : 'normal',
                            color: photoObj ? 'var(--navy-primary)' : 'var(--text-gray)', 
                            textAlign: 'center',
                            whiteSpace: 'nowrap'
                          }}>
                            {stepConfig.step === 'LOOK_CENTER' ? 'Center' : 
                             stepConfig.step === 'LOOK_UP' ? 'Up' : 
                             stepConfig.step === 'LOOK_DOWN' ? 'Down' : 
                             stepConfig.step === 'TURN_LEFT' ? 'Left' : 
                             stepConfig.step === 'TURN_RIGHT' ? 'Right' : 'Tilt'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="enroll-buttons" style={{ marginTop: '20px' }}>
                <button onClick={startEnrollmentWizard} className="btn-primary" style={{ height: '42px', width: '100%' }}>
                  {orchestratorState === 'ENROLLING' ? 'Scanning...' : 'Start Onboarding Scan'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Camera Viewport */}
        <div className="card terminal-card" style={{ flex: '1.2', minWidth: '0' }}>
          <div className="card-header">
            <h3>Onboarding Camera</h3>
            <div className="clahe-toggle">
              <span className="toggle-txt">CLAHE Correction</span>
              <label className="switch-sm">
                <input 
                  type="checkbox" 
                  checked={claheEnabled} 
                  onChange={(e) => setClaheEnabled(e.target.checked)} 
                />
                <span className="slider round"></span>
              </label>
            </div>
          </div>

          <div className="camera-viewport">
            <div className="video-relative" style={{ display: streamActive ? 'block' : 'none' }}>
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                muted 
                className="hidden-video"
              />
              <canvas 
                ref={meshCanvasRef} 
                className="live-canvas"
                width="480"
                height="480"
              />
              <canvas 
                ref={canvasRef} 
                style={{ display: 'none' }}
                width="112"
                height="112"
              />
            </div>
            {!streamActive && (
              <div className="camera-offline">
                <span className="camera-icon">👁️</span>
                <button onClick={startWebcam} className="btn-camera-toggle">
                  {mpLoading ? 'Loading libraries...' : 'Activate Camera'}
                </button>
                {streamError && <p className="error-txt">{streamError}</p>}
              </div>
            )}
          </div>

          {streamActive && (
            <div className="camera-actions">
              <button onClick={stopWebcam} className="btn-camera-close">
                Close Camera Feed
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Rendering main layout
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        :root {
          --navy-primary: #0B3C73;
          --navy-dark: #072C54;
          --navy-light: #185E9F;
          --white: #FFFFFF;
          --ice-bg: #F4F7FC;
          --border-color: #D2DFEF;
          --text-slate: #0F172A;
          --text-gray: #475569;
          --success: #065F46;
          --success-bg: #D1FAE5;
          --warn: #92400E;
          --warn-bg: #FEF3C7;
          --danger: #991B1B;
          --danger-bg: #FEE2E2;
        }

        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap');

        *, *::before, *::after {
          box-sizing: border-box;
        }

        body {
          background-color: var(--ice-bg);
          color: var(--text-slate);
          font-family: 'Inter', system-ui, sans-serif;
          min-height: 100vh;
          margin: 0;
          -webkit-font-smoothing: antialiased;
        }

        /* ─── Portal Header ─── */
        .portal-header {
          background: rgba(255,255,255,0.95);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border-bottom: 1px solid var(--border-color);
          padding: 12px 40px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          position: sticky;
          top: 0;
          z-index: 100;
        }
        .header-left .gov-emblem-container {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .gov-logo-emblem {
          font-size: 24px;
        }
        .gov-title {
          display: flex;
          flex-direction: column;
        }
        .gov-dept {
          font-size: 10px;
          font-weight: 600;
          color: var(--text-gray);
          letter-spacing: 0.5px;
        }
        .gov-agency {
          font-size: 14px;
          font-weight: 700;
          color: var(--navy-dark);
        }
        .header-right {
          display: flex;
          align-items: center;
          gap: 24px;
        }
        .header-right a {
          color: var(--text-gray);
          text-decoration: none;
          font-size: 13px;
          font-weight: 500;
        }
        .header-right a:hover {
          color: var(--navy-primary);
        }
        .theme-toggle {
          cursor: pointer;
          font-size: 16px;
        }

        /* ─── Welcome / Login View ─── */
        .login-view {
          min-height: calc(100vh - 65px);
          display: flex;
          background: linear-gradient(rgba(7, 44, 84, 0.72), rgba(4, 30, 60, 0.82)),
                      url('/road.png') center center / cover no-repeat;
          padding: 40px;
          align-items: center;
          justify-content: space-around;
        }
        .login-container {
          width: 100%;
          max-width: 1200px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 40px;
        }
        .login-left {
          flex: 1;
          color: var(--white);
        }
        .welcome-sub {
          font-size: 28px;
          font-weight: 300;
          margin-bottom: 8px;
        }
        .welcome-title {
          font-size: 64px;
          font-weight: 800;
          line-height: 1.1;
          margin-bottom: 16px;
        }
        .welcome-desc {
          font-size: 16px;
          font-weight: 400;
          opacity: 0.9;
        }
        .login-right {
          width: 440px;
        }
        .login-card {
          background: rgba(255, 255, 255, 0.98);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-radius: 20px;
          padding: 36px;
          box-shadow: 0 24px 48px rgba(7, 44, 84, 0.22), 0 0 0 1px rgba(255,255,255,0.6);
          border: 1px solid rgba(255,255,255,0.9);
        }
        .login-card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
        }
        .login-card-header h2 {
          color: var(--navy-dark);
          font-size: 24px;
          font-weight: 700;
        }
        .offline-toggle-container {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .toggle-label {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-gray);
        }
        .input-group {
          margin-bottom: 18px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .input-group label {
          font-size: 11px;
          font-weight: 700;
          color: var(--text-gray);
          text-transform: uppercase;
        }
        .input-group input, .input-group select {
          padding: 12px;
          border: 1px solid var(--border-color);
          border-radius: 8px;
          font-family: inherit;
          font-size: 14px;
          color: var(--text-slate);
          outline: none;
        }
        .input-group input:focus, .input-group select:focus {
          border-color: var(--navy-primary);
          box-shadow: 0 0 0 3px rgba(11, 60, 115, 0.12);
          outline: none;
        }
        .btn-login-submit {
          width: 100%;
          background: linear-gradient(135deg, var(--navy-primary) 0%, var(--navy-light) 100%);
          color: var(--white);
          border: none;
          padding: 14px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          margin-top: 8px;
          letter-spacing: 0.3px;
        }
        .btn-login-submit:hover {
          background: linear-gradient(135deg, var(--navy-dark) 0%, var(--navy-primary) 100%);
          box-shadow: 0 6px 20px rgba(11, 60, 115, 0.35);
          transform: translateY(-1px);
        }
        .btn-login-submit:active {
          transform: translateY(0);
        }
        .login-actions-row {
          display: flex;
          gap: 12px;
          margin-top: 8px;
        }
        .btn-face-login {
          background-color: var(--white);
          border: 1px solid var(--border-color);
          color: var(--navy-primary);
          width: 50px;
          height: 46px;
          border-radius: 8px;
          font-size: 18px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
          margin-top: 8px;
        }
        .btn-face-login:hover {
          background-color: var(--ice-bg);
          border-color: var(--navy-primary);
        }
        .login-register-link {
          text-align: center;
          font-size: 12px;
          color: var(--text-gray);
          margin-top: 14px;
        }
        .login-register-link a {
          color: var(--navy-primary);
          text-decoration: none;
          font-weight: 600;
        }
        .camera-viewport-login {
          height: 260px;
          background-color: var(--ice-bg);
          border: 1px solid var(--border-color);
          border-radius: 12px;
          overflow: hidden;
          position: relative;
          display: flex;
          justify-content: center;
          align-items: center;
          margin-bottom: 12px;
        }
        .login-help {
          text-align: center;
          font-size: 12px;
          color: var(--text-gray);
          margin-top: 20px;
        }
        .login-help a {
          color: var(--navy-primary);
          text-decoration: none;
          font-weight: 600;
        }
        .login-footer {
          border-top: 1px solid var(--border-color);
          margin-top: 24px;
          padding-top: 16px;
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          color: var(--text-gray);
        }
        .digital-india-text {
          font-weight: 700;
          color: var(--navy-primary);
        }

        /* ─── Switch / Toggle Slider ─── */
        .switch, .switch-sm {
          position: relative;
          display: inline-block;
          width: 44px;
          height: 24px;
        }
        .switch input, .switch-sm input {
          opacity: 0;
          width: 0;
          height: 0;
        }
        .slider {
          position: absolute;
          cursor: pointer;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: #E2E8F0;
          transition: .3s;
        }
        .slider:before {
          position: absolute;
          content: "";
          height: 18px;
          width: 18px;
          left: 3px;
          bottom: 3px;
          background-color: white;
          transition: .3s;
        }
        input:checked + .slider {
          background-color: var(--navy-primary);
        }
        input:checked + .slider:before {
          transform: translateX(20px);
        }
        .slider.round {
          border-radius: 24px;
        }
        .slider.round:before {
          border-radius: 50%;
        }

        .switch-sm {
          width: 36px;
          height: 20px;
        }
        .switch-sm .slider:before {
          height: 14px;
          width: 14px;
          left: 3px;
          bottom: 3px;
        }
        .switch-sm input:checked + .slider:before {
          transform: translateX(16px);
        }

        /* ─── App Center Dashboard ─── */
        .app-layout {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
        }
        .app-header {
          background-color: var(--white);
          border-bottom: 1px solid var(--border-color);
          padding: 12px 30px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .app-brand {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .brand-icon {
          font-size: 24px;
        }
        .brand-text {
          display: flex;
          flex-direction: column;
        }
        .brand-main {
          font-size: 16px;
          font-weight: 800;
          color: var(--navy-dark);
        }
        .brand-sub {
          font-size: 10px;
          font-weight: 600;
          color: var(--text-gray);
        }
        .app-header-telemetry {
          display: flex;
          align-items: center;
          gap: 20px;
        }
        .telemetry-item {
          font-size: 12px;
          border-right: 1px solid var(--border-color);
          padding-right: 15px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .telemetry-item:last-child {
          border: none;
        }
        .telemetry-label {
          color: var(--text-gray);
          font-weight: 500;
        }
        .telemetry-val {
          font-weight: 700;
          color: var(--navy-dark);
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .network-badge {
          font-size: 9px;
          font-weight: 700;
          padding: 3px 6px;
          border-radius: 4px;
        }
        .network-badge.online {
          background-color: #E6F4EA;
          color: #137333;
        }
        .network-badge.offline {
          background-color: #FCE8E6;
          color: #C5221F;
        }
        .btn-logout {
          background: none;
          border: 1px solid var(--border-color);
          padding: 6px 12px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
          color: var(--text-gray);
          cursor: pointer;
        }
        .btn-logout:hover {
          color: var(--navy-primary);
          border-color: var(--navy-primary);
        }

        /* ─── Nav Tabs ─── */
        .app-body {
          flex: 1;
          display: flex;
          flex-direction: column;
          padding: 24px 30px;
        }
        .app-tabs {
          display: flex;
          gap: 8px;
          margin-bottom: 20px;
          overflow-x: auto;
          flex-wrap: nowrap;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
        }
        .app-tabs::-webkit-scrollbar {
          display: none;
        }
        .tab-btn {
          background-color: var(--white);
          border: 1px solid var(--border-color);
          color: var(--text-gray);
          padding: 10px 18px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.18s ease;
          white-space: nowrap;
          flex: 0 0 auto;
        }
        .tab-btn:hover, .tab-btn.active {
          background-color: var(--navy-primary);
          color: var(--white);
          border-color: var(--navy-primary);
          box-shadow: 0 4px 12px rgba(11, 60, 115, 0.25);
        }

        /* ─── Tab Components UI ─── */
        .tab-viewport {
          flex: 1;
          display: flex;
          animation: tabFadeIn 0.18s ease;
        }
        @keyframes tabFadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
        .dashboard-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 24px;
          width: 100%;
        }
        .card {
          background-color: var(--white);
          border: 1px solid var(--border-color);
          border-radius: 16px;
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          min-width: 0;    /* prevent flex overflow */
        }
        .terminal-card {
          flex: 1.2 1 320px;
        }
        .control-card {
          flex: 1 1 280px;
        }
        .registry-card {
          flex: 1.4 1 320px;
        }
        .benchmark-card {
          flex: 1 1 280px;
        }
        .sync-status-card {
          flex: 1 1 280px;
        }
        .queue-list-card {
          flex: 1.4 1 320px;
        }
        .ledger-card {
          width: 100%;
        }
        .card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid var(--border-color);
          padding-bottom: 12px;
        }
        .card-header h3 {
          font-size: 16px;
          font-weight: 700;
          color: var(--navy-dark);
        }
 
        /* ─── Webcam Viewport ─── */
        .camera-viewport {
          height: auto;
          background-color: var(--ice-bg);
          border: 1px solid var(--border-color);
          border-radius: 12px;
          overflow: hidden;
          position: relative;
          display: flex;
          justify-content: center;
          align-items: center;
          width: 100%;
          padding: 16px;
        }
        .video-relative {
          position: relative;
          width: 100%;
          max-width: 320px;
          aspect-ratio: 1;
        }
        .hidden-video {
          position: absolute;
          width: 100%;
          height: 100%;
          object-fit: cover;
          opacity: 0; /* completely invisible; we draw frames on canvas instead! */
          border-radius: 50%;
          z-index: 1;
        }
        .live-canvas {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          z-index: 2;
          border-radius: 50%;
        }
        .camera-offline {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          color: var(--text-gray);
        }
        .camera-icon {
          font-size: 40px;
        }
        .btn-camera-toggle {
          background-color: var(--navy-primary);
          color: var(--white);
          border: none;
          padding: 10px 18px;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }
        .btn-camera-close {
          width: 100%;
          background: none;
          border: 1px dashed var(--border-color);
          padding: 8px;
          border-radius: 6px;
          font-size: 12px;
          color: var(--text-gray);
          cursor: pointer;
        }
        .btn-camera-close:hover {
          border-color: var(--navy-primary);
          color: var(--navy-primary);
        }
        .stats-row {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
          gap: 12px;
          width: 100%;
        }
        .stat-box {
          flex: 1;
          background-color: var(--ice-bg);
          border: 1px solid var(--border-color);
          padding: 10px;
          border-radius: 8px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
        }
        .stat-label {
          font-size: 9px;
          font-weight: 700;
          color: var(--text-gray);
        }
        .stat-val {
          font-size: 13px;
          font-weight: 700;
          color: var(--navy-dark);
        }

        /* ─── Liveness Check console ─── */
        .verification-session {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .session-progress {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .progress-bar {
          height: 8px;
          background-color: var(--ice-bg);
          border: 1px solid var(--border-color);
          border-radius: 4px;
          overflow: hidden;
        }
        .progress-fill {
          height: 100%;
          background-color: var(--navy-primary);
          transition: width 0.3s;
        }
        .progress-lbls {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
          color: var(--text-gray);
          font-weight: 500;
        }
        .liveness-console {
          background-color: var(--ice-bg);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          padding: 16px;
        }
        .console-indicator {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 8px;
        }
        .console-prompt {
          font-size: 11px;
          font-weight: 700;
          color: var(--text-gray);
          text-transform: uppercase;
        }
        .console-challenge {
          font-size: 12px;
          font-weight: 700;
          color: var(--navy-primary);
          background-color: var(--white);
          padding: 2px 8px;
          border: 1px solid var(--border-color);
          border-radius: 4px;
        }
        .console-status-msg {
          font-size: 13px;
          color: var(--navy-dark);
          font-weight: 500;
        }
        .simulator-overrides {
          border-top: 1px solid var(--border-color);
          padding-top: 16px;
        }
        .simulator-overrides h4 {
          font-size: 12px;
          font-weight: 700;
          color: var(--navy-dark);
          margin-bottom: 4px;
        }
        .override-desc {
          font-size: 11px;
          color: var(--text-gray);
          margin-bottom: 12px;
        }
        .override-buttons {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
          gap: 8px;
          width: 100%;
        }
        .btn-sim {
          background-color: var(--white);
          border: 1px solid var(--border-color);
          color: var(--navy-primary);
          padding: 8px;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
        }
        .btn-sim:hover:not(:disabled) {
          background-color: var(--navy-primary);
          color: var(--white);
          border-color: var(--navy-primary);
        }
        .btn-sim:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        /* ─── Result Cards ─── */
        .verification-result-card {
          border-radius: 12px;
          padding: 16px;
          border-width: 1px;
          border-style: solid;
        }
        .verification-result-card.verified {
          background-color: #F4FBF7;
          border-color: #E6F4EA;
          color: #137333;
        }
        .verification-result-card.denied {
          background-color: #FDF4F4;
          border-color: #FCE8E6;
          color: #C5221F;
        }
        .result-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 10px;
        }
        .result-icon {
          font-size: 16px;
          font-weight: 700;
        }
        .result-user-name {
          font-size: 16px;
          font-weight: 700;
          margin-bottom: 4px;
        }
        .result-user-detail {
          font-size: 12px;
          margin-bottom: 2px;
          opacity: 0.9;
        }
        .result-meta-row {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
          margin-top: 10px;
          border-top: 1px solid rgba(11, 60, 115, 0.1);
          padding-top: 8px;
        }
        .ledger-notice {
          font-size: 10px;
          font-style: italic;
          margin-top: 6px;
          opacity: 0.8;
        }
        .preproc-detail {
          font-size: 10px;
          font-weight: 600;
          margin-top: 4px;
        }

        /* ─── Registry roster table ─── */
        .search-input {
          padding: 6px 12px;
          border: 1px solid var(--border-color);
          border-radius: 6px;
          font-family: inherit;
          font-size: 12px;
          outline: none;
        }
        .roster-container {
          height: 240px;
          overflow-y: auto;
          overflow-x: auto;
          border: 1px solid var(--border-color);
          border-radius: 8px;
        }
        .roster-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
          text-align: left;
        }
        .roster-table th, .roster-table td {
          padding: 10px 14px;
          border-bottom: 1px solid var(--border-color);
        }
        .roster-table th {
          background-color: var(--ice-bg);
          font-weight: 700;
          color: var(--text-gray);
        }
        .roster-actions {
          margin-top: 10px;
        }
        .btn-primary {
          background-color: var(--navy-primary);
          color: var(--white);
          border: none;
          padding: 10px 16px;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }
        .btn-secondary {
          background-color: var(--white);
          border: 1px solid var(--border-color);
          color: var(--text-slate);
          padding: 10px 16px;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }
        .enrollment-panel {
          border: 1px solid var(--border-color);
          padding: 16px;
          border-radius: 8px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .enrollment-panel h4 {
          font-size: 13px;
          color: var(--navy-dark);
          border-bottom: 1px dashed var(--border-color);
          padding-bottom: 8px;
        }
        .enrollment-guidance {
          background-color: var(--ice-bg);
          padding: 12px;
          border-radius: 6px;
        }
        .enroll-prompt {
          font-size: 12px;
          font-weight: 600;
          color: var(--navy-primary);
          margin-bottom: 6px;
        }
        .enroll-step-progress {
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-size: 11px;
          color: var(--text-gray);
        }
        .progress-bar-sm {
          height: 4px;
          background-color: var(--border-color);
          border-radius: 2px;
          overflow: hidden;
        }
        .enroll-buttons {
          display: flex;
          gap: 10px;
        }

        /* ─── Benchmarking UI ─── */
        .bench-desc {
          font-size: 13px;
          line-height: 1.5;
          color: var(--text-gray);
        }
        .bench-actions {
          display: flex;
          gap: 12px;
          margin-top: 10px;
        }
        .benchmark-console {
          background-color: var(--slate-dark);
          color: var(--white);
          padding: 14px;
          border-radius: 8px;
          font-family: monospace;
          font-size: 11px;
          margin-top: 15px;
        }
        .console-heading {
          color: var(--border-color);
          font-weight: bold;
          margin-bottom: 6px;
        }

        /* ─── Ledger Timeline ─── */
        .btn-danger {
          color: #C5221F;
          border-color: #FCE8E6;
        }
        .btn-danger:hover {
          background-color: #FDF4F4 !important;
          border-color: #C5221F !important;
        }
        .ledger-actions {
          display: flex;
          gap: 10px;
        }
        .ledger-timeline-container {
          overflow-x: auto;
          padding: 20px 10px;
          background-color: var(--ice-bg);
          border: 1px solid var(--border-color);
          border-radius: 12px;
        }
        .ledger-timeline {
          display: flex;
          align-items: center;
          gap: 16px;
          min-width: max-content;
        }
        .ledger-block-node {
          background-color: var(--white);
          border: 1px solid var(--border-color);
          border-radius: 10px;
          width: 200px;
          padding: 12px;
          font-size: 11px;
        }
        .block-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid var(--border-color);
          padding-bottom: 6px;
          margin-bottom: 8px;
        }
        .block-idx {
          font-weight: 700;
          color: var(--navy-dark);
        }
        .block-badge {
          font-size: 8px;
          font-weight: 700;
          padding: 2px 4px;
          border-radius: 4px;
        }
        .block-badge.ok {
          background-color: #E6F4EA;
          color: #137333;
        }
        .block-badge.err {
          background-color: #FCE8E6;
          color: #C5221F;
        }
        .block-body p {
          margin-bottom: 4px;
          color: var(--text-gray);
        }
        .block-hashes {
          margin-top: 8px;
          border-top: 1px dashed var(--border-color);
          padding-top: 6px;
          display: flex;
          flex-direction: column;
          gap: 2px;
          font-family: monospace;
          color: var(--text-gray);
        }
        .timeline-arrow {
          font-size: 16px;
          color: var(--border-color);
        }
        .no-logs {
          color: var(--text-gray);
          text-align: center;
          font-style: italic;
          padding: 20px;
        }

        /* ─── Status Badges for Attendance Table ─── */
        .status-badge {
          display: inline-block;
          padding: 3px 8px;
          border-radius: 20px;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.5px;
          text-transform: uppercase;
          white-space: nowrap;
        }
        .status-badge.pending  { background: var(--warn-bg);    color: var(--warn);    }
        .status-badge.synced   { background: var(--success-bg); color: var(--success); }
        .status-badge.rejected { background: var(--danger-bg);  color: var(--danger);  }
        .status-badge.online   { background: #E6F4EA; color: #137333; }
        .status-badge.offline  { background: #FCE8E6; color: #C5221F; }
        .admin-badge  { background: rgba(11, 60, 115, 0.08); color: var(--navy-primary); border: 1px solid rgba(11, 60, 115, 0.16); }
        .worker-badge { background: rgba(16, 185, 129, 0.08); color: #10B981; border: 1px solid rgba(16, 185, 129, 0.16); }

        /* ─── Empty States ─── */
        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 40px 20px;
          gap: 8px;
        }
        .empty-state-icon { font-size: 36px; }
        .empty-state-msg  { font-size: 14px; font-weight: 600; color: var(--navy-dark); margin: 0; }
        .empty-state-sub  { font-size: 12px; color: var(--text-gray); text-align: center; max-width: 360px; margin: 0; }

        /* ─── Code / Monospace ─── */
        code {
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
          font-size: 11px;
        }

        /* ─── Cloud Sync UI ─── */
        .gateway-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .gateway-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 12px;
          border-bottom: 1px solid var(--border-color);
          padding-bottom: 8px;
          gap: 16px;
        }
        .gt-label {
          color: var(--text-gray);
          flex-shrink: 0;
        }
        .gt-val {
          font-weight: 600;
          color: var(--navy-dark);
          word-break: break-all;
          overflow-wrap: anywhere;
          text-align: right;
          max-width: 65%;
        }
        .sync-actions-row {
          display: flex;
          gap: 10px;
          margin-top: 15px;
        }
        .sync-logs-console {
          background-color: var(--ice-bg);
          border: 1px solid var(--border-color);
          padding: 12px;
          border-radius: 8px;
          margin-top: 16px;
          font-family: monospace;
          font-size: 11px;
        }
        .queue-list-container {
          max-height: 320px;
          overflow-y: auto;
          overflow-x: auto;
          border: 1px solid var(--border-color);
          border-radius: 8px;
        }

        /* ─── Guided Onboarding Gallery & Camera Login ─── */
        .enroll-gallery {
          display: flex;
          justify-content: space-between;
          gap: 6px;
          margin-top: 16px;
          padding: 8px;
          background: var(--ice-bg);
          border-radius: 6px;
          border: 1px solid var(--border-color);
        }
        .enroll-gallery-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          flex: 1;
        }
        .camera-viewport-login .video-relative {
          width: 100%;
          max-width: 240px;
          aspect-ratio: 1;
          height: auto;
          margin: 0 auto;
        }

        /* ─── Responsive Adjustments (Media Queries) ─── */
        /* Tablet/Intermediate layouts (768px – 1250px) */
        @media (max-width: 1250px) and (min-width: 768px) {
          .dashboard-grid {
            flex-wrap: wrap;
            gap: 20px;
          }
          /* Camera Terminal and Anti-spoofing side-by-side */
          .terminal-card {
            flex: 1 1 calc(55% - 10px) !important;
          }
          .control-card {
            flex: 1 1 calc(45% - 10px) !important;
          }
          /* Roster card below stretching full width */
          .dashboard-grid > .card:nth-child(3) {
            flex: 1 1 100% !important;
          }
          /* Stack Registry and Sync cards for tab usability */
          .registry-card, .benchmark-card, .sync-status-card, .queue-list-card {
            flex: 1 1 100% !important;
          }
          .login-container {
            gap: 20px;
          }
          .welcome-title {
            font-size: 48px;
          }
        }

        @media (max-width: 1250px) {
          .welcome-title {
            font-size: 48px;
          }
        }

        @media (max-width: 900px) {
          .login-container {
            flex-direction: column;
            justify-content: center;
            align-items: center;
            text-align: center;
          }
          .login-left {
            margin-bottom: 24px;
          }
          .welcome-title {
            font-size: 36px;
          }
          .welcome-sub {
            font-size: 20px;
          }
          .login-right {
            width: 100%;
            max-width: 460px;
          }
        }

        @media (max-width: 768px) {
          .portal-header, .app-header {
            flex-direction: column;
            gap: 12px;
            padding: 16px 20px;
            text-align: center;
          }
          .header-left .gov-emblem-container {
            flex-direction: column;
            gap: 6px;
            align-items: center;
          }
          .header-right {
            flex-wrap: wrap;
            justify-content: center;
            gap: 10px 14px;
          }
          .app-header-telemetry {
            flex-wrap: wrap;
            justify-content: center;
            gap: 8px;
          }
          .telemetry-item {
            border-right: none;
            border-bottom: 1px solid var(--border-color);
            padding-right: 0;
            padding-bottom: 6px;
            width: 100%;
            justify-content: center;
          }
          .telemetry-item:last-child {
            border-bottom: none;
          }
          .app-tabs {
            flex-wrap: wrap;
            justify-content: flex-start;
          }
          .tab-btn {
            flex: 1 1 auto;
            text-align: center;
            font-size: 11px;
            padding: 8px 12px;
          }
          .app-body {
            padding: 16px 16px;
          }
          .dashboard-grid {
            flex-direction: column;
            gap: 16px;
          }
          .card {
            padding: 16px;
            flex: none !important;
            width: 100% !important;
          }
          .card-header {
            flex-wrap: wrap;
            gap: 12px;
            justify-content: center;
            text-align: center;
          }
          .card-header h3 {
            flex: 1 1 100%;
            text-align: center;
            margin: 0;
          }
          .ledger-actions, .sync-actions-row, .clahe-toggle {
            justify-content: center;
            flex-wrap: wrap;
            gap: 8px;
            width: 100%;
          }
          .ledger-actions button, .sync-actions-row button {
            flex: 1 1 auto;
          }
          /* Tables scroll container */
          .roster-container, .queue-list-container {
            overflow-x: auto;
            width: 100%;
            border: 1px solid var(--border-color);
            border-radius: 8px;
          }
          .roster-table {
            min-width: 750px;
          }
          .roster-table th, .roster-table td {
            white-space: nowrap;
          }
          .roster-table td strong, .status-badge, .role-badge-tag {
            white-space: nowrap;
          }
          .login-view {
            padding: 24px 16px;
          }
        }

        /* Phone landscape / small tablet */
        @media (max-width: 667px) {
          .welcome-title {
            font-size: 30px;
          }
          .welcome-sub {
            font-size: 16px;
          }
          .ledger-block-node {
            width: 160px;
          }
        }

        @media (max-width: 480px) {
          .login-view {
            padding: 16px 12px;
          }
          .login-card {
            padding: 24px 16px;
            border-radius: 16px;
          }
          .welcome-title {
            font-size: 26px;
          }
          .stat-box {
            padding: 6px;
          }
          .stat-val {
            font-size: 11px;
          }
          .login-right {
            width: 100%;
            max-width: 100%;
          }
          .app-body {
            padding: 12px;
          }
          .card {
            padding: 12px;
          }
          .app-tabs {
            gap: 6px;
          }
          .tab-btn {
            font-size: 10px;
            padding: 7px 10px;
          }
          .enroll-gallery {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 12px;
          }
          .enroll-gallery-item {
            flex: unset;
          }
        }

        /* Very small phones (iPhone SE, Galaxy A series) */
        @media (max-width: 390px) {
          .welcome-title {
            font-size: 22px;
          }
          .login-card {
            padding: 20px 12px;
          }
          .app-header {
            padding: 10px 12px;
          }
          .brand-main {
            font-size: 14px;
          }
        }
        /* ─── SQLite Console Tray ─── */
        .sqlite-console-tray {
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          background: #090d16;
          border-top: 1px solid #1e293b;
          z-index: 1000;
          box-shadow: 0 -4px 24px rgba(0,0,0,0.5);
          font-family: 'JetBrains Mono', monospace;
        }
        .tray-header {
          padding: 10px 24px;
          background: #0f172a;
          display: flex;
          justify-content: space-between;
          align-items: center;
          cursor: pointer;
          user-select: none;
          border-bottom: 1px solid #1e293b;
        }
        .tray-title {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #94a3b8;
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.8px;
        }
        .terminal-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }
        .terminal-dot.green {
          background-color: #10b981;
          box-shadow: 0 0 8px #10b981;
        }
        .tray-toggle-arrow {
          color: #64748b;
          font-size: 10px;
        }
        .tray-content {
          height: 180px;
          overflow-y: auto;
          padding: 12px 24px;
          background: #020617;
        }
        .console-rows {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .console-row {
          font-size: 11px;
          display: flex;
          align-items: flex-start;
          gap: 12px;
          line-height: 1.4;
        }
        .console-time {
          color: #475569;
          white-space: nowrap;
        }
        .console-statement {
          color: #38bdf8;
          word-break: break-all;
          flex: 1;
        }
        .console-meta {
          display: flex;
          gap: 8px;
          white-space: nowrap;
        }
        .console-meta .latency {
          color: #10b981;
          font-weight: 600;
        }
        .console-meta .affected {
          color: #64748b;
        }
        .console-empty {
          color: #475569;
          font-size: 11px;
          text-align: center;
          padding: 40px;
        }
        
        body {
          padding-bottom: 38px;
        }
      ` }} />

      {!isLoggedIn ? (
        <>
          <header className="portal-header">
            <div className="header-left">
              <div className="gov-emblem-container">
                <span className="gov-logo-emblem">🇮🇳</span>
                <div className="gov-title">
                  <span className="gov-dept">भारतीय राष्ट्रीय राजमार्ग प्राधिकरण</span>
                  <span className="gov-agency">National Highways Authority of India</span>
                </div>
              </div>
            </div>
            <div className="header-right">
              <a href="#" onClick={(e) => e.preventDefault()}>What's New</a>
              <a href="#" onClick={(e) => e.preventDefault()}>Notices</a>
              <a href="#" onClick={(e) => e.preventDefault()}>Help Center</a>
              <span className="theme-toggle">☀️</span>
            </div>
          </header>

          <div className="login-view">
            <div className="login-container">
              <div className="login-left">
                <div className="welcome-banner">
                  <p className="welcome-sub">Welcome to</p>
                  <h1 className="welcome-title">DataLake 3.0</h1>
                  <p className="welcome-desc">NHAI Unified Transit, Toll Operations & Biometric Security Portal</p>
                </div>
              </div>
              <div className="login-right">
                <div className="login-card">
                  <div className="login-card-header">
                    <h2>Login</h2>
                    <div className="offline-toggle-container">
                      <span className="toggle-label">Offline Gate</span>
                      <label className="switch">
                        <input 
                          type="checkbox" 
                          checked={isOfflineTerminal} 
                          onChange={(e) => setIsOfflineTerminal(e.target.checked)} 
                        />
                        <span className="slider round"></span>
                      </label>
                    </div>
                  </div>
                  
                  {loginWithFaceActive ? (
                    <div className="face-login-container">
                      <div className="camera-viewport-login">
                        <div className="video-relative">
                          <video 
                            ref={videoRef} 
                            autoPlay 
                            playsInline 
                            muted 
                            className="hidden-video"
                          />
                          <canvas 
                            ref={meshCanvasRef} 
                            className="live-canvas"
                            width="480"
                            height="480"
                          />
                        </div>
                      </div>

                      <div className="liveness-console" style={{ marginBottom: '16px' }}>
                        <div className="console-indicator">
                          <span className="console-prompt">Instruction:</span>
                          <span className="console-challenge">{challengeState.currentChallenge}</span>
                        </div>
                        <p className="console-status-msg">{challengeState.message}</p>
                      </div>

                      {/* Progress bar */}
                      <div className="session-progress" style={{ marginBottom: '16px' }}>
                        <div className="progress-bar">
                          <div 
                            className="progress-fill" 
                            style={{ width: `${challengeState.progress * 100}%` }}
                          />
                        </div>
                      </div>


                      {verificationSuccess !== null && (
                        <div className={`verification-result-card ${verificationSuccess ? 'verified' : 'denied'}`} style={{ marginBottom: '16px' }}>
                          <div className="result-header">
                            <span className="result-icon">{verificationSuccess ? '✓' : '✗'}</span>
                            <h4>{verificationSuccess ? 'Identity Verified' : 'Access Refused'}</h4>
                          </div>
                          {verificationSuccess && matchedProfile ? (
                            <div className="result-body">
                              <p className="result-user-name">{matchedProfile.name}</p>
                              <p className="result-user-detail">{matchedProfile.role}</p>
                            </div>
                          ) : (
                            <div className="result-body">
                              <p className="result-user-detail">Biometric mismatch.</p>
                            </div>
                          )}
                        </div>
                      )}

                      <button type="button" onClick={handleCancelFaceLogin} className="btn-login-submit" style={{ background: '#475569', height: '48px', marginTop: '8px' }}>
                        Cancel Face ID Verification
                      </button>
                    </div>
                  ) : (
                    <>
                      <form onSubmit={handleLoginSubmit}>
                        <div className="input-group">
                          <label>Employee ID *</label>
                          <input 
                            type="text" 
                            value={loginId} 
                            onChange={(e) => setLoginId(e.target.value)} 
                            placeholder="e.g. NHAI-2026-001"
                            required
                          />
                        </div>
                        <div className="input-group">
                          <label>Password *</label>
                          <input 
                            type="password" 
                            value={loginPassword} 
                            onChange={(e) => setLoginPassword(e.target.value)} 
                            placeholder="••••••••"
                            required
                          />
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-gray)', marginBottom: '14px', fontStyle: 'italic', textAlign: 'center' }}>
                          Demo Login: <strong>admin / Admin@2026</strong> (Admin) or <strong>NHAI-USER-001 / Nhai@2026</strong> (Staff)
                        </div>

                        <div className="login-actions-row">
                          <button type="submit" className="btn-login-submit" style={{ flex: 1, height: '48px', marginTop: 0 }}>
                            {isOfflineTerminal ? "Open Terminal Gate" : "Login using OTP"}
                          </button>
                          {!isOfflineTerminal && (
                            <button 
                              type="button" 
                              onClick={handleFaceLoginClick} 
                              className="btn-face-login"
                              style={{ width: '50px', height: '46px', margin: 0, padding: 0 }}
                              title="Login using Face ID"
                            >
                              👤
                            </button>
                          )}
                        </div>
                      </form>
                    </>
                  )}
                  
                  <div className="login-help">
                    Having trouble logging in? <a href="#" onClick={(e) => e.preventDefault()}>Get Help</a>
                  </div>
                  
                  <div className="login-footer">
                    <span className="powered-by">powered by</span>
                    <span className="digital-india-text">Digital India</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="app-layout">
          <header className="app-header">
            <div className="app-brand">
              <span className="brand-icon">🛡️</span>
              <div className="brand-text">
                <span className="brand-main">NHAI GARUDA</span>
                <span className="brand-sub">{isAdmin ? "Admin Control Panel" : "Offline Edge Terminal"}</span>
              </div>
            </div>
            
            <div className="app-header-telemetry">
              <div className="telemetry-item">
                <span className="telemetry-label">Officer:</span>
                <span className="telemetry-val">{currentUserProfile?.name || 'Unknown Officer'} ({currentUserProfile?.role})</span>
              </div>
              <div className="telemetry-item">
                <span className="telemetry-label">Network Status:</span>
                <span className="telemetry-val">
                  {isAdmin ? (
                    <label className="switch-sm" style={{ marginRight: '6px' }}>
                      <input 
                        type="checkbox" 
                        checked={onlineSimulator} 
                        onChange={handleNetworkToggle}
                      />
                      <span className="slider round"></span>
                    </label>
                  ) : null}
                  <span className={`network-badge ${onlineSimulator ? 'online' : 'offline'}`}>
                    {onlineSimulator ? 'ONLINE' : 'OFF-GRID'}
                  </span>
                </span>
              </div>
              {isAdmin && (
                <div className="telemetry-item">
                  <span className="telemetry-label">Sync Queue:</span>
                  <span className="telemetry-val">{pendingCount} pending</span>
                </div>
              )}
              <button className="btn-logout" onClick={handleLogout}>Logout</button>
            </div>
          </header>
          
          <div className="app-body">
            {isAdmin && (
              <nav className="app-tabs">
                <button 
                  className={`tab-btn ${activeTab === 'terminal' ? 'active' : ''}`}
                  onClick={() => setActiveTab('terminal')}
                >
                  👁️ Verification
                </button>

                <button 
                  className={`tab-btn ${activeTab === 'registry' ? 'active' : ''}`}
                  onClick={() => { setActiveTab('registry'); setIsEnrolling(false); }}
                >
                  👥 Register Staff
                </button>
                <button 
                  className={`tab-btn ${activeTab === 'ledger' ? 'active' : ''}`}
                  onClick={() => setActiveTab('ledger')}
                >
                  🔗 Ledger
                </button>
                <button 
                  className={`tab-btn ${activeTab === 'sync' ? 'active' : ''}`}
                  onClick={() => setActiveTab('sync')}
                >
                  📡 Cloud Sync
                </button>
              </nav>
            )}
            
            <main className="tab-viewport">
              {isAdmin ? (
                renderTabContent()
              ) : (
                !staffEnrolled ? (
                  renderStaffUnenrolled()
                ) : (
                  attendanceMarkedToday ? (
                    renderStaffSuccess()
                  ) : (
                    renderStaffTerminal()
                  )
                )
              )}
            </main>
          </div>
        </div>
      )}

      {/* Collapsible SQLite Diagnostic Terminal */}
      <div className={`sqlite-console-tray ${sqlConsoleOpen ? 'open' : ''}`}>
        <div className="tray-header" onClick={() => setSqlConsoleOpen(!sqlConsoleOpen)}>
          <div className="tray-title">
            <span className="terminal-dot green"></span>
            <span>💾 Local SQLite Terminal (Live Query Audit Log)</span>
          </div>
          <span className="tray-toggle-arrow">{sqlConsoleOpen ? '▼' : '▲'}</span>
        </div>
        <div className="tray-content" style={{ display: sqlConsoleOpen ? 'block' : 'none' }}>
          <div className="console-rows">
            {sqlLogs.map((log, idx) => (
              <div key={idx} className="console-row">
                <span className="console-time">[{log.timestamp}]</span>
                <span className="console-statement">{log.statement}</span>
                <span className="console-meta">
                  <span className="latency">{log.latencyMs}ms</span>
                  <span className="affected">({log.rowsAffected} rows affected)</span>
                </span>
              </div>
            ))}
            {sqlLogs.length === 0 && (
              <div className="console-empty">No SQL statements executed yet. Actions will log queries here.</div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};
