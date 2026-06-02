import React, { useState, useEffect, useRef } from 'react';
import { LivenessMathService, Landmark3D } from '../services/livenessMath';



const INSPECTOR_KEYS = [
  { index: 1, label: 'Nose Tip' },
  { index: 10, label: 'Forehead Center' },
  { index: 152, label: 'Chin Base' },
  { index: 33, label: 'Right Eye Inner' },
  { index: 263, label: 'Left Eye Inner' },
  { index: 61, label: 'Right Lip Corner' },
  { index: 291, label: 'Left Lip Corner' }
];

export const MediaPipeCheck: React.FC = () => {
  const livenessService = LivenessMathService.getInstance();

  // Refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraHelperRef = useRef<any>(null);
  const faceMeshRef = useRef<any>(null);

  // States
  const [cameraActive, setCameraActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Performance Benchmarks
  const [fps, setFps] = useState<number>(0);
  const [latency, setLatency] = useState<number>(0);
  const lastFrameTimeRef = useRef<number>(performance.now());
  const frameTimesListRef = useRef<number[]>([]);

  // Mathematical Telemetry States
  const [liveEAR, setLiveEAR] = useState<number>(0.30);
  const [liveMAR, setLiveMAR] = useState<number>(0.15);
  const [poseYaw, setPoseYaw] = useState<number>(0);
  const [posePitch, setPosePitch] = useState<number>(0);
  const [poseRoll, setPoseRoll] = useState<number>(0);
  const [activeLandmarks, setActiveLandmarks] = useState<Landmark3D[]>([]);

  // REPRESENTATION RENDER STATE CONTROLS
  const [drawTessellation, setDrawTessellation] = useState(true);
  const [drawContourLines, setDrawContourLines] = useState(true);
  const [drawAllPoints, setDrawAllPoints] = useState(true);
  const [drawDepthHeatmap, setDrawDepthHeatmap] = useState(false);
  const [drawLandmarkIds, setDrawLandmarkIds] = useState(false);
  const [drawSymmetryGrid, setDrawSymmetryGrid] = useState(false);
  const [drawRotationVector, setDrawRotationVector] = useState(true);

  // CUSTOMIZATION PARAMETERS
  const [pointRadius, setPointRadius] = useState<number>(1.2);
  const [lineWidth, setLineWidth] = useState<number>(1.0);
  const [meshOpacity, setMeshOpacity] = useState<number>(0.3);
  const [meshColor, setMeshColor] = useState<'cyan' | 'green' | 'white'>('cyan');
  
  // ALGORITHM PARAMETERS (SENSITIVITY)
  const [blinkThresholdMult, setBlinkThresholdMult] = useState<number>(0.60);
  const [smileThresholdMult, setSmileThresholdMult] = useState<number>(1.50);
  const [yawThresholdLimit, setYawThresholdLimit] = useState<number>(15.0);
  const [refineLandmarks, setRefineLandmarks] = useState<boolean>(true);

  // CRITICAL FIX: Persistent Refs to store settings and completely bypass the HMR callback closure trap
  const drawTessellationRef = useRef(drawTessellation);
  const drawContourLinesRef = useRef(drawContourLines);
  const drawAllPointsRef = useRef(drawAllPoints);
  const drawDepthHeatmapRef = useRef(drawDepthHeatmap);
  const drawLandmarkIdsRef = useRef(drawLandmarkIds);
  const drawSymmetryGridRef = useRef(drawSymmetryGrid);
  const drawRotationVectorRef = useRef(drawRotationVector);
  const pointRadiusRef = useRef(pointRadius);
  const lineWidthRef = useRef(lineWidth);
  const meshOpacityRef = useRef(meshOpacity);
  const meshColorRef = useRef(meshColor);
  const refineLandmarksRef = useRef(refineLandmarks);

  // Sync state changes to refs immediately on render
  useEffect(() => { drawTessellationRef.current = drawTessellation; }, [drawTessellation]);
  useEffect(() => { drawContourLinesRef.current = drawContourLines; }, [drawContourLines]);
  useEffect(() => { drawAllPointsRef.current = drawAllPoints; }, [drawAllPoints]);
  useEffect(() => { drawDepthHeatmapRef.current = drawDepthHeatmap; }, [drawDepthHeatmap]);
  useEffect(() => { drawLandmarkIdsRef.current = drawLandmarkIds; }, [drawLandmarkIds]);
  useEffect(() => { drawSymmetryGridRef.current = drawSymmetryGrid; }, [drawSymmetryGrid]);
  useEffect(() => { drawRotationVectorRef.current = drawRotationVector; }, [drawRotationVector]);
  useEffect(() => { pointRadiusRef.current = pointRadius; }, [pointRadius]);
  useEffect(() => { lineWidthRef.current = lineWidth; }, [lineWidth]);
  useEffect(() => { meshOpacityRef.current = meshOpacity; }, [meshOpacity]);
  useEffect(() => { meshColorRef.current = meshColor; }, [meshColor]);
  useEffect(() => { refineLandmarksRef.current = refineLandmarks; }, [refineLandmarks]);

  useEffect(() => {
    startMeshCheck();
    return () => {
      stopMeshCheck();
    };
  }, [refineLandmarks]); // Re-initialize when iris refinement is toggled

  const stopMeshCheck = () => {
    if (cameraHelperRef.current) {
      try {
        cameraHelperRef.current.stop();
      } catch (e) {}
      cameraHelperRef.current = null;
    }
    if (faceMeshRef.current) {
      try {
        faceMeshRef.current.close();
      } catch (e) {}
      faceMeshRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    
    // Clear canvas
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  };

  const startMeshCheck = async () => {
    if (loading) return;
    setLoading(true);
    setErrorMsg(null);

    // Verify script availability
    if (!(window as any).FaceMesh || !(window as any).Camera) {
      setErrorMsg('MediaPipe FaceMesh core dependencies are missing. Verify CDN availability.');
      setLoading(false);
      return;
    }

    try {
      stopMeshCheck();

      // Bootstrap FaceMesh WASM configuration
      // CRITICAL: Use absolute URLs - the WASM engine runs in a Web Worker where relative paths
      // resolve against the worker script URL, not the page URL
      const origin = window.location.origin;
      const faceMesh = new (window as any).FaceMesh({
        locateFile: (file: string) => `${origin}/${file}`
      });

      faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: refineLandmarksRef.current,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });

      faceMesh.onResults(processMeshFrame);
      faceMeshRef.current = faceMesh;

      // Access Webcam
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;

        const cameraHelper = new (window as any).Camera(videoRef.current, {
          onFrame: async () => {
            if (videoRef.current && faceMeshRef.current) {
              await faceMeshRef.current.send({ image: videoRef.current });
            }
          },
          width: 640,
          height: 480
        });

        cameraHelperRef.current = cameraHelper;
        await cameraHelper.start();
        setCameraActive(true);
      }
    } catch (err: any) {
      console.error('Failed booting MediaPipe validation portal:', err);
      setErrorMsg(`Webcam bootstrap failed: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  const processMeshFrame = (results: any) => {
    const startMs = performance.now();

    // 1. Dynamic FPS estimation
    const now = performance.now();
    const elapsed = now - lastFrameTimeRef.current;
    lastFrameTimeRef.current = now;

    if (elapsed > 0) {
      const currentFps = 1000.0 / elapsed;
      frameTimesListRef.current.push(currentFps);
      if (frameTimesListRef.current.length > 30) {
        frameTimesListRef.current.shift();
      }
      const avgFps = frameTimesListRef.current.reduce((a, b) => a + b, 0) / frameTimesListRef.current.length;
      setFps(avgFps);
    }

    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
    }

    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
      setLatency(performance.now() - startMs);
      return;
    }

    const landmarks = results.multiFaceLandmarks[0];

    const scaledLandmarks: Landmark3D[] = landmarks.map((l: any) => ({
      x: l.x * 640,
      y: l.y * 480,
      z: l.z * 640
    }));

    setActiveLandmarks(scaledLandmarks);

    // Compute dynamic parameters
    const ear = livenessService.calculateEAR(scaledLandmarks);
    const mar = livenessService.calculateMAR(scaledLandmarks);
    const pose = livenessService.estimatePose(scaledLandmarks);

    setLiveEAR(ear);
    setLiveMAR(mar);
    setPoseYaw(pose.yaw);
    setPosePitch(pose.pitch);
    setPoseRoll(pose.roll);

    // 2. Render Overlay Representations using the latest Ref configurations (closure-safe!)
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        drawCustomizedRepresentations(ctx, landmarks, pose.yaw, pose.pitch);
      }
    }

    // 3. Compute Latency
    setLatency(performance.now() - startMs);
  };

  const drawCustomizedRepresentations = (ctx: CanvasRenderingContext2D, landmarks: any[], yaw: number, pitch: number) => {
    if (!canvasRef.current) return;
    const width = canvasRef.current.width;
    const height = canvasRef.current.height;

    ctx.clearRect(0, 0, width, height);

    // Theme Profiles Colors Configuration
    let primaryColor = '#ffffff';
    let tessOpacityColor = `rgba(255, 255, 255, ${meshOpacityRef.current})`;
    
    if (meshColorRef.current === 'cyan') {
      primaryColor = '#00f0ff';
      tessOpacityColor = `rgba(0, 240, 255, ${meshOpacityRef.current})`;
    } else if (meshColorRef.current === 'green') {
      primaryColor = '#00ff66';
      tessOpacityColor = `rgba(0, 255, 102, ${meshOpacityRef.current})`;
    }

    const drawConnectors = (window as any).drawConnectors;
    const drawLandmarks = (window as any).drawLandmarks;
    
    // Resolve MediaPipe Namespace Safely across different browser wrapper compiles
    const mpGlobal = (window as any);
    const mpFaceMesh = mpGlobal.FaceMesh || mpGlobal.mpFaceMesh || mpGlobal;

    // A. REPRESENTATION 1: FACEMESH_TESSELLATION (Complex 3D Triangulation Grid)
    if (drawTessellationRef.current && drawConnectors) {
      const tessellation = mpFaceMesh.FACEMESH_TESSELLATION || mpGlobal.FACEMESH_TESSELLATION;
      if (tessellation) {
        drawConnectors(ctx, landmarks, tessellation, {
          color: tessOpacityColor,
          lineWidth: lineWidthRef.current * 0.8
        });
      }
    }

    // B. REPRESENTATION 2: Outline Contours (Face Oval, Eyes, Brows, Lips loops)
    if (drawContourLinesRef.current) {
      if (drawConnectors) {
        const faceOval = mpFaceMesh.FACEMESH_FACE_OVAL || mpGlobal.FACEMESH_FACE_OVAL;
        const leftEye = mpFaceMesh.FACEMESH_LEFT_EYE || mpGlobal.FACEMESH_LEFT_EYE;
        const leftEyebrow = mpFaceMesh.FACEMESH_LEFT_EYEBROW || mpGlobal.FACEMESH_LEFT_EYEBROW;
        const rightEye = mpFaceMesh.FACEMESH_RIGHT_EYE || mpGlobal.FACEMESH_RIGHT_EYE;
        const rightEyebrow = mpFaceMesh.FACEMESH_RIGHT_EYEBROW || mpGlobal.FACEMESH_RIGHT_EYEBROW;
        const lips = mpFaceMesh.FACEMESH_LIPS || mpGlobal.FACEMESH_LIPS;

        if (faceOval) drawConnectors(ctx, landmarks, faceOval, { color: primaryColor, lineWidth: lineWidthRef.current * 1.5 });
        if (leftEye) drawConnectors(ctx, landmarks, leftEye, { color: primaryColor, lineWidth: lineWidthRef.current * 1.2 });
        if (leftEyebrow) drawConnectors(ctx, landmarks, leftEyebrow, { color: primaryColor, lineWidth: lineWidthRef.current * 1.2 });
        if (rightEye) drawConnectors(ctx, landmarks, rightEye, { color: primaryColor, lineWidth: lineWidthRef.current * 1.2 });
        if (rightEyebrow) drawConnectors(ctx, landmarks, rightEyebrow, { color: primaryColor, lineWidth: lineWidthRef.current * 1.2 });
        if (lips) drawConnectors(ctx, landmarks, lips, { color: primaryColor, lineWidth: lineWidthRef.current * 1.5 });
      }
    }

    // C. REPRESENTATION 3 & 4: Landmark Node Points (All 468 vertices or Z-Depth Heatmap)
    if (drawAllPointsRef.current) {
      if (drawDepthHeatmapRef.current) {
        // Dynamic Depth Heatmap: Map node relative Z values to color gradient transitions!
        let minZ = Infinity;
        let maxZ = -Infinity;
        landmarks.forEach((l) => {
          if (l.z < minZ) minZ = l.z;
          if (l.z > maxZ) maxZ = l.z;
        });
        const rangeZ = maxZ - minZ || 1.0;

        landmarks.forEach((pt) => {
          if (pt) {
            const pct = (pt.z - minZ) / rangeZ; // 0 (closest) to 1 (furthest)
            // Color mapping: closest is glowing Cyan/White, furthest is fading dark red
            const r = Math.round(0 + (1 - pct) * 255);
            const g = Math.round(240 * (1 - pct));
            const b = Math.round(255 * (1 - pct));
            ctx.beginPath();
            ctx.arc(pt.x * width, pt.y * height, pointRadiusRef.current, 0, 2 * Math.PI);
            ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
            ctx.fill();
          }
        });
      } else if (drawLandmarks) {
        // Standard high-speed landmarks renderer
        drawLandmarks(ctx, landmarks, {
          color: primaryColor,
          lineWidth: 0.2,
          radius: pointRadiusRef.current
        });
      }
    }

    // D. REPRESENTATION 5: Landmark Index IDs (Developer Labels #0 to #467)
    if (drawLandmarkIdsRef.current) {
      ctx.fillStyle = primaryColor;
      ctx.font = '6.5px monospace';
      landmarks.forEach((pt, idx) => {
        if (pt && idx % 3 === 0) { // Render every 3rd index to avoid extreme textual overlapping overlap
          ctx.fillText(idx.toString(), pt.x * width + 2, pt.y * height - 2);
        }
      });
    }

    // E. REPRESENTATION 6: Symmetry Alignment Grid (Center Balance axis)
    if (drawSymmetryGridRef.current) {
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)'; // Light red axis
      ctx.lineWidth = 0.8;
      
      // Forehead center node 10 to Chin base node 152
      const forehead = landmarks[10];
      const chin = landmarks[152];
      if (forehead && chin) {
        ctx.beginPath();
        ctx.moveTo(forehead.x * width, forehead.y * height);
        ctx.lineTo(chin.x * width, chin.y * height);
        ctx.stroke();
      }

      // Horizontal grids across eyes inner corners
      const rEye = landmarks[33];
      const lEye = landmarks[263];
      if (rEye && lEye) {
        ctx.beginPath();
        ctx.moveTo(rEye.x * width, rEye.y * height);
        ctx.lineTo(lEye.x * width, lEye.y * height);
        ctx.stroke();
      }
    }

    // F. REPRESENTATION 7: Head Rotation 3D normal vector projections
    if (drawRotationVectorRef.current) {
      const nose = landmarks[1];
      if (nose) {
        const startX = nose.x * width;
        const startY = nose.y * height;
        const arrowLength = 65;
        
        // Trigonometric rotation projections
        const endX = startX - Math.sin(yaw * Math.PI / 180) * arrowLength;
        const endY = startY + Math.sin(pitch * Math.PI / 180) * arrowLength;

        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.strokeStyle = '#ef4444'; // Solid crimson vector projection arrow
        ctx.lineWidth = 2.2;
        ctx.stroke();

        // Arrow head
        ctx.beginPath();
        ctx.arc(endX, endY, 3, 0, 2 * Math.PI);
        ctx.fillStyle = '#ef4444';
        ctx.fill();
      }
    }

    // G. Always highlight 7 critical dynamic anchor validation points in high contrast red
    const keyAnchors = [1, 10, 152, 33, 263, 61, 291];
    keyAnchors.forEach((idx) => {
      const pt = landmarks[idx];
      if (pt) {
        ctx.beginPath();
        ctx.arc(pt.x * width, pt.y * height, 3.5, 0, 2 * Math.PI);
        ctx.fillStyle = '#ef4444'; 
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
    });
  };

  const resetBaseUrl = () => {
    window.location.search = ''; 
  };

  return (
    <div className="test-screen-container">
      <style>{`
        .test-screen-container {
          min-height: 100vh;
          width: 100%;
          background-color: #000000;
          color: #ffffff;
          font-family: monospace;
          display: flex;
          flex-direction: column;
          padding: 24px;
          box-sizing: border-box;
        }

        .test-header {
          border-bottom: 1px solid #222222;
          padding-bottom: 14px;
          margin-bottom: 24px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .test-title h1 {
          font-size: 18px;
          font-weight: 700;
          letter-spacing: 2px;
          margin: 0;
          color: #ffffff;
        }

        .test-title span {
          font-size: 11px;
          color: #666666;
          text-transform: uppercase;
          letter-spacing: 1px;
        }

        .test-grid {
          display: grid;
          grid-template-columns: 1.2fr 1fr;
          gap: 32px;
          flex: 1;
        }

        @media (max-width: 1100px) {
          .test-grid {
            grid-template-columns: 1fr;
          }
        }

        .viewport-box {
          border: 1px solid #222222;
          background-color: #050505;
          border-radius: 4px;
          position: relative;
          display: flex;
          justify-content: center;
          align-items: center;
          aspect-ratio: 4/3;
          overflow: hidden;
          width: 100%;
          max-width: 640px;
          margin: 0 auto;
        }

        .viewport-inner {
          position: relative;
          width: 100%;
          height: 100%;
          transform: scaleX(-1);
        }

        .webcam-stream {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          object-fit: contain;
          background-color: #000;
        }

        .overlay-canvas {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          object-fit: contain;
          pointer-events: none;
        }

        .viewport-placeholder {
          position: absolute;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          color: #666666;
          font-size: 12px;
          gap: 12px;
        }

        .panel-box {
          border: 1px solid #222222;
          background-color: #050505;
          padding: 24px;
          border-radius: 4px;
          display: flex;
          flex-direction: column;
          gap: 20px;
          overflow-y: auto;
          max-height: calc(100vh - 120px);
        }

        .panel-section-title {
          font-size: 12px;
          color: #666666;
          text-transform: uppercase;
          letter-spacing: 1px;
          border-left: 2px solid #ffffff;
          padding-left: 10px;
          margin-bottom: 12px;
          font-weight: 700;
        }

        .metrics-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 12px;
        }

        .metric-card {
          border: 1px dashed #222222;
          padding: 12px;
          border-radius: 2px;
        }

        .metric-label {
          font-size: 10px;
          color: #666666;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .metric-value {
          font-size: 16px;
          font-weight: 700;
          color: #ffffff;
          margin-top: 4px;
        }

        .metric-value.highlight {
          color: #00f0ff;
        }

        .table-container {
          overflow-x: auto;
          margin-top: 6px;
        }

        .coords-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 11px;
          text-align: left;
        }

        .coords-table th {
          border-bottom: 1px solid #222222;
          color: #666666;
          padding: 6px 4px;
          font-weight: normal;
        }

        .coords-table td {
          border-bottom: 1px solid #111111;
          color: #bbbbbb;
          padding: 6px 4px;
        }

        .control-row {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 12px;
          margin-top: 4px;
        }

        .checkbox-input {
          accent-color: #ffffff;
          cursor: pointer;
        }

        .theme-select {
          background: #000000;
          color: #ffffff;
          border: 1px solid #222222;
          padding: 4px 8px;
          font-family: inherit;
          font-size: 11px;
          outline: none;
          cursor: pointer;
        }

        .slider-control {
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-size: 11px;
          margin-top: 6px;
        }

        .slider-label-row {
          display: flex;
          justify-content: space-between;
          color: #bbbbbb;
        }

        .range-slider {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 3px;
          background: #222222;
          outline: none;
          accent-color: #ffffff;
        }

        .range-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 10px;
          height: 10px;
          background: #ffffff;
          cursor: pointer;
          border-radius: 50%;
        }

        .action-btn-mono {
          background: #ffffff;
          color: #000000;
          border: none;
          padding: 10px 16px;
          font-family: inherit;
          font-weight: bold;
          font-size: 12px;
          cursor: pointer;
          transition: all 0.2s ease;
          letter-spacing: 1px;
        }

        .action-btn-mono:hover {
          background: #cccccc;
        }

        .action-btn-outline {
          background: none;
          color: #ffffff;
          border: 1px solid #222222;
          padding: 10px 16px;
          font-family: inherit;
          font-size: 12px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .action-btn-outline:hover {
          border-color: #ffffff;
          background: rgba(255,255,255,0.05);
        }

        .button-group {
          display: flex;
          gap: 12px;
          width: 100%;
        }

        .status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background-color: #ff0000;
          display: inline-block;
          margin-right: 6px;
        }

        .status-dot.active {
          background-color: #00ff00;
        }

        .activity-spinner-mono {
          width: 24px;
          height: 24px;
          border: 2px solid #ffffff;
          border-top-color: transparent;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      {/* Header Banner */}
      <header className="test-header">
        <div className="test-title">
          <h1>OFFICIAL MEDIAPIPE CORE AUDITING SUITE</h1>
          <span>Validation Lab with 3D Pose vector & Depth Heatmap Gradients</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '11px', color: '#888888', display: 'flex', alignItems: 'center' }}>
            <span className={`status-dot ${cameraActive ? 'active' : ''}`}></span>
            {cameraActive ? 'CAMERA CONNECTED' : 'CAMERA DISCONNECTED'}
          </span>
          <button className="action-btn-outline" onClick={resetBaseUrl}>
            ← Exit Test Portal
          </button>
        </div>
      </header>

      {/* Primary Grid Layout */}
      <main className="test-grid">
        
        {/* Left Side: Real-time Viewport (100% Stuck Mesh) */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="viewport-box">
            <div className="viewport-inner" style={{ display: cameraActive ? 'block' : 'none' }}>
              <video
                ref={videoRef}
                className="webcam-stream"
                autoPlay
                playsInline
                muted
              />
              <canvas
                ref={canvasRef}
                className="overlay-canvas"
              />
            </div>
            
            {!cameraActive && (
              <div className="viewport-placeholder">
                {loading ? (
                  <>
                    <div className="activity-spinner-mono"></div>
                    <span>Initializing MediaPipe FaceMesh WASM Engine...</span>
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: '24px' }}>📷</span>
                    <span>Camera Live Pipeline Suspended</span>
                    {errorMsg && <span style={{ color: '#ff4444', fontSize: '10px', marginTop: '6px', textAlign: 'center', maxWidth: '300px' }}>{errorMsg}</span>}
                  </>
                )}
              </div>
            )}
          </div>

          <div className="button-group" style={{ maxWidth: '640px', margin: '0 auto' }}>
            {cameraActive ? (
              <button className="action-btn-outline" style={{ flex: 1 }} onClick={stopMeshCheck}>
                🛑 Disable Live Pipeline
              </button>
            ) : (
              <button className="action-btn-mono" style={{ flex: 1 }} onClick={startMeshCheck} disabled={loading}>
                {loading ? 'Starting...' : '🚀 Initialize Live Pipeline'}
              </button>
            )}
          </div>
        </section>

        {/* Right Side: Telemetry Metrics Terminals */}
        <section className="panel-box">
          
          {/* Section 1: Performance Diagnostics */}
          <div>
            <div className="panel-section-title">Execution Performance</div>
            <div className="metrics-grid">
              <div className="metric-card">
                <div className="metric-label">Refresh Frame Rate</div>
                <div className="metric-value highlight">
                  {cameraActive ? `${fps.toFixed(1)} FPS` : '0.0 FPS'}
                </div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Frame Latency</div>
                <div className="metric-value">
                  {cameraActive ? `${latency.toFixed(1)} ms` : '0.0 ms'}
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Mathematical Estimations */}
          <div>
            <div className="panel-section-title">Liveness Structural Telemetry</div>
            <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              <div className="metric-card">
                <div className="metric-label">EAR (Eyes)</div>
                <div className="metric-value" style={{ color: liveEAR < blinkThresholdMult * 0.35 ? '#ef4444' : '#ffffff' }}>
                  {liveEAR.toFixed(3)}
                </div>
              </div>
              <div className="metric-card">
                <div className="metric-label">MAR (Lips)</div>
                <div className="metric-value">
                  {liveMAR.toFixed(3)}
                </div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Nose Depth (Z)</div>
                <div className="metric-value">
                  {activeLandmarks[1] ? activeLandmarks[1].z.toFixed(1) : '0.0'}
                </div>
              </div>
            </div>

            <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginTop: '12px' }}>
              <div className="metric-card">
                <div className="metric-label">Yaw (Euler-Y)</div>
                <div className="metric-value" style={{ color: Math.abs(poseYaw) > yawThresholdLimit ? '#10b981' : '#ffffff' }}>
                  {poseYaw.toFixed(1)}°
                </div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Pitch (Euler-X)</div>
                <div className="metric-value">
                  {posePitch.toFixed(1)}°
                </div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Roll (Euler-Z)</div>
                <div className="metric-value">
                  {poseRoll.toFixed(1)}°
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Mesh Representations Toggles */}
          <div>
            <div className="panel-section-title">FaceMesh Representations</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', marginTop: '6px' }}>
              <label className="control-row">
                <input
                  type="checkbox"
                  className="checkbox-input"
                  checked={drawTessellation}
                  onChange={(e) => setDrawTessellation(e.target.checked)}
                />
                <span>Triangles Tessellator</span>
              </label>

              <label className="control-row">
                <input
                  type="checkbox"
                  className="checkbox-input"
                  checked={drawContourLines}
                  onChange={(e) => setDrawContourLines(e.target.checked)}
                />
                <span>Feature Contours</span>
              </label>

              <label className="control-row">
                <input
                  type="checkbox"
                  className="checkbox-input"
                  checked={drawAllPoints}
                  onChange={(e) => setDrawAllPoints(e.target.checked)}
                />
                <span>Vertex Dots (468)</span>
              </label>

              <label className="control-row">
                <input
                  type="checkbox"
                  className="checkbox-input"
                  checked={drawDepthHeatmap}
                  onChange={(e) => setDrawDepthHeatmap(e.target.checked)}
                />
                <span>Z-Depth Heatmap</span>
              </label>

              <label className="control-row">
                <input
                  type="checkbox"
                  className="checkbox-input"
                  checked={drawLandmarkIds}
                  onChange={(e) => setDrawLandmarkIds(e.target.checked)}
                />
                <span>Landmark Index IDs</span>
              </label>

              <label className="control-row">
                <input
                  type="checkbox"
                  className="checkbox-input"
                  checked={drawSymmetryGrid}
                  onChange={(e) => setDrawSymmetryGrid(e.target.checked)}
                />
                <span>Symmetry Axis Grid</span>
              </label>

              <label className="control-row" style={{ gridColumn: 'span 2' }}>
                <input
                  type="checkbox"
                  className="checkbox-input"
                  checked={drawRotationVector}
                  onChange={(e) => setDrawRotationVector(e.target.checked)}
                />
                <span>3D Rotation Direction Vector (Nose Normal Arrow)</span>
              </label>
            </div>
          </div>

          {/* Section 4: Render Customization Sliders */}
          <div>
            <div className="panel-section-title">Mesh Render Customizations</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="slider-control">
                <div className="slider-label-row">
                  <span>Vertex Point Size:</span>
                  <span>{pointRadius.toFixed(1)} px</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="4.0"
                  step="0.1"
                  className="range-slider"
                  value={pointRadius}
                  onChange={(e) => setPointRadius(parseFloat(e.target.value))}
                />
              </div>

              <div className="slider-control">
                <div className="slider-label-row">
                  <span>Connection Line Width:</span>
                  <span>{lineWidth.toFixed(1)} px</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="3.0"
                  step="0.1"
                  className="range-slider"
                  value={lineWidth}
                  onChange={(e) => setLineWidth(parseFloat(e.target.value))}
                />
              </div>

              <div className="slider-control">
                <div className="slider-label-row">
                  <span>Wireframe Opacity:</span>
                  <span>{Math.round(meshOpacity * 100)} %</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="1.0"
                  step="0.05"
                  className="range-slider"
                  value={meshOpacity}
                  onChange={(e) => setMeshOpacity(parseFloat(e.target.value))}
                />
              </div>

              <div className="control-row">
                <span>Color Profile:</span>
                <select
                  className="theme-select"
                  value={meshColor}
                  onChange={(e) => setMeshColor(e.target.value as any)}
                >
                  <option value="cyan">Cyber Neon Cyan</option>
                  <option value="green">Matrix Cyber Green</option>
                  <option value="white">Monochrome White</option>
                </select>
              </div>
            </div>
          </div>

          {/* Section 5: Dynamic Algorithmic Thresholds */}
          <div>
            <div className="panel-section-title">Liveness Sensitivity Limits</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="slider-control">
                <div className="slider-label-row">
                  <span>Blink EAR Threshold:</span>
                  <span>{blinkThresholdMult.toFixed(2)}x baseline</span>
                </div>
                <input
                  type="range"
                  min="0.40"
                  max="0.80"
                  step="0.02"
                  className="range-slider"
                  value={blinkThresholdMult}
                  onChange={(e) => setBlinkThresholdMult(parseFloat(e.target.value))}
                />
              </div>

              <div className="slider-control">
                <div className="slider-label-row">
                  <span>Smile MAR Threshold:</span>
                  <span>{smileThresholdMult.toFixed(2)}x baseline</span>
                </div>
                <input
                  type="range"
                  min="1.10"
                  max="1.80"
                  step="0.02"
                  className="range-slider"
                  value={smileThresholdMult}
                  onChange={(e) => setSmileThresholdMult(parseFloat(e.target.value))}
                />
              </div>

              <div className="slider-control">
                <div className="slider-label-row">
                  <span>Head Turn Yaw Threshold:</span>
                  <span>{yawThresholdLimit.toFixed(1)}° limit</span>
                </div>
                <input
                  type="range"
                  min="10.0"
                  max="25.0"
                  step="0.5"
                  className="range-slider"
                  value={yawThresholdLimit}
                  onChange={(e) => setYawThresholdLimit(parseFloat(e.target.value))}
                />
              </div>

              <label className="control-row">
                <input
                  type="checkbox"
                  className="checkbox-input"
                  checked={refineLandmarks}
                  onChange={(e) => setRefineLandmarks(e.target.checked)}
                />
                <span>Enable Iris Landmark Refinement (Requires WASM reload)</span>
              </label>
            </div>
          </div>

          {/* Section 6: Landmark Inspector */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div className="panel-section-title">Anchor Node Coordinates</div>
            <div className="table-container" style={{ flex: 1, maxHeight: '180px' }}>
              <table className="coords-table">
                <thead>
                  <tr>
                    <th>Anchor Name</th>
                    <th>Node Index</th>
                    <th>Axis-X</th>
                    <th>Axis-Y</th>
                    <th>Axis-Z</th>
                  </tr>
                </thead>
                <tbody>
                  {INSPECTOR_KEYS.map((key) => {
                    const pt = activeLandmarks[key.index];
                    return (
                      <tr key={key.index}>
                        <td style={{ color: '#ffffff' }}>{key.label}</td>
                        <td>#{key.index}</td>
                        <td>{pt ? pt.x.toFixed(1) : '---'}</td>
                        <td>{pt ? pt.y.toFixed(1) : '---'}</td>
                        <td>{pt ? pt.z.toFixed(1) : '---'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

        </section>

      </main>
    </div>
  );
};
