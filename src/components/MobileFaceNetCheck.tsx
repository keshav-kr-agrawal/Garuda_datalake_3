import React, { useState, useRef, useEffect, useCallback } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// MobileFaceNetCheck.tsx  ·  Full-featured offline identity verification lab
// Features: named enrollment gallery, 1:N matching, full parameter controls
// NO CDN · NO FALLBACK · window.tf + window.tflite from local script tags
// ─────────────────────────────────────────────────────────────────────────────

const getTF     = () => (window as any).tf     as any;
const getTFLite = () => (window as any).tflite as any;

const MODEL_URL      = `${window.location.origin}/mobile_facenet.tflite`;
const WASM_PATH      = `${window.location.origin}/tflite-wasm/`;
const DEFAULT_SIZE   = 112;
const DEFAULT_DIM    = 192;

// ── Types ─────────────────────────────────────────────────────────────────────
interface EnrolledFace {
  id: string;
  name: string;
  embedding: Float32Array;
  thumbnail: string;
  enrolledAt: string;
}

interface MatchResult {
  face: EnrolledFace;
  similarity: number;
  match: boolean;
}

// ── Inference Parameters (all via useRef for closure-safe callbacks) ──────────
interface Params {
  threshold: number;          // 0.50 – 0.95
  inputSize: number;          // 112 or 160
  normMode: 'neg1to1' | '0to1'; // [-1,1] or [0,1]
  mirrorCam: boolean;
  showOverlay: boolean;
  showBrackets: boolean;
  showAllScores: boolean;     // show full ranked list in overlay
  embDimsShown: number;       // 8 / 16 / 32 / 64
  maxEnrolled: number;        // cap gallery size
  topNDisplay: number;        // how many top matches to show in UI
}

const DEFAULT_PARAMS: Params = {
  threshold:    0.72,
  inputSize:    DEFAULT_SIZE,
  normMode:     'neg1to1',
  mirrorCam:    true,
  showOverlay:  true,
  showBrackets: true,
  showAllScores:false,
  embDimsShown: 32,
  maxEnrolled:  20,
  topNDisplay:  5,
};

// ─────────────────────────────────────────────────────────────────────────────
export const MobileFaceNetCheck: React.FC = () => {

  // ── Status ──────────────────────────────────────────────────────────────────
  const [status, setStatus]         = useState<'idle'|'loading'|'ready'|'error'>('idle');
  const [errorMsg, setErrorMsg]     = useState<string|null>(null);
  const [modelInfo, setModelInfo]   = useState<Record<string,string>|null>(null);

  // ── Camera / inference live states ──────────────────────────────────────────
  const [cameraActive, setCameraActive] = useState(false);
  const [fps, setFps]                   = useState(0);
  const [inferenceMs, setInferenceMs]   = useState(0);
  const [embVec, setEmbVec]             = useState<number[]>([]);
  const [liveThumb, setLiveThumb]       = useState<string|null>(null);

  // ── Enrollment gallery ───────────────────────────────────────────────────────
  const [gallery, setGallery]           = useState<EnrolledFace[]>([]);
  const [pendingName, setPendingName]   = useState('');
  const [editingId, setEditingId]       = useState<string|null>(null);
  const [editingName, setEditingName]   = useState('');

  // ── Verification results ─────────────────────────────────────────────────────
  const [topMatches, setTopMatches]     = useState<MatchResult[]>([]);

  // ── Parameters (state = UI, ref = loop-safe) ─────────────────────────────────
  const [params, setParams]    = useState<Params>(DEFAULT_PARAMS);
  const paramsRef              = useRef<Params>(DEFAULT_PARAMS);
  const galleryRef             = useRef<EnrolledFace[]>([]);
  const topMatchesRef          = useRef<MatchResult[]>([]);

  // Sync refs
  useEffect(() => { paramsRef.current  = params;  }, [params]);
  useEffect(() => { galleryRef.current = gallery; }, [gallery]);
  useEffect(() => { topMatchesRef.current = topMatches; }, [topMatches]);

  // ── DOM refs ─────────────────────────────────────────────────────────────────
  const modelRef    = useRef<any>(null);
  const videoRef    = useRef<HTMLVideoElement|null>(null);
  const canvasRef   = useRef<HTMLCanvasElement|null>(null);
  const overlayRef  = useRef<HTMLCanvasElement|null>(null);
  const animRef     = useRef<number|null>(null);
  const lastFpsRef  = useRef(performance.now());

  useEffect(() => () => { stopCamera(); }, []);

  // ── Helpers: set a single param ──────────────────────────────────────────────
  const setParam = <K extends keyof Params>(key: K, val: Params[K]) => {
    setParams(p => { const n = { ...p, [key]: val }; paramsRef.current = n; return n; });
  };

  // ── Load model ────────────────────────────────────────────────────────────────
  const loadModel = async () => {
    setStatus('loading'); setErrorMsg(null);
    const tf = getTF(); const tflite = getTFLite();
    if (!tf || !tflite) {
      setErrorMsg('window.tf or window.tflite not found. Check index.html script tags.');
      setStatus('error'); return;
    }
    try {
      tflite.setWasmPath(WASM_PATH);
      const model = await tflite.loadTFLiteModel(MODEL_URL);
      modelRef.current = model;
      const ins  = model.inputs  ?? [];
      const outs = model.outputs ?? [];
      setModelInfo({
        'Model file':    '/mobile_facenet.tflite  (5 MB)',
        'WASM runtime':  '/tflite-wasm/  (local, no CDN)',
        'CDN used':      '🚫 NONE — 100% Offline',
        'Input shape':   JSON.stringify(ins[0]?.shape  ?? '?'),
        'Output shape':  JSON.stringify(outs[0]?.shape ?? '?'),
        'Embedding dim': String(DEFAULT_DIM),
      });
      setStatus('ready');
    } catch (e: any) {
      setErrorMsg(`Load failed: ${e.message || String(e)}`);
      setStatus('error');
    }
  };

  // ── Camera ────────────────────────────────────────────────────────────────────
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' }, audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await new Promise<void>(r => { videoRef.current!.onloadedmetadata = () => r(); });
        videoRef.current.play();
        setCameraActive(true);
        runLoop();
      }
    } catch (e: any) { setErrorMsg(`Camera: ${e.message}`); }
  };

  const stopCamera = () => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  // ── Core: crop → normalize → infer → embed ───────────────────────────────────
  const getEmbedding = async (ctx: CanvasRenderingContext2D, size: number): Promise<Float32Array|null> => {
    if (!modelRef.current) return null;
    const tf   = getTF();
    const imgD = ctx.getImageData(0, 0, size, size);
    const raw  = new Float32Array(size * size * 3);
    const p    = paramsRef.current;
    for (let i = 0, j = 0; i < imgD.data.length; i += 4, j += 3) {
      const r = imgD.data[i], g = imgD.data[i+1], b = imgD.data[i+2];
      if (p.normMode === 'neg1to1') {
        raw[j] = (r/127.5)-1; raw[j+1] = (g/127.5)-1; raw[j+2] = (b/127.5)-1;
      } else {
        raw[j] = r/255;      raw[j+1] = g/255;       raw[j+2] = b/255;
      }
    }
    const inp = tf.tensor4d(raw, [1, size, size, 3]);
    const out = modelRef.current.predict(inp) as any;
    const res = new Float32Array(await out.data());
    inp.dispose(); out.dispose();
    return l2Norm(res);
  };

  // ── Inference loop ────────────────────────────────────────────────────────────
  const runLoop = useCallback(() => {
    const loop = async () => {
      if (!videoRef.current || !modelRef.current || !canvasRef.current) {
        animRef.current = requestAnimationFrame(loop); return;
      }
      const now = performance.now();
      setFps(Math.round(1000 / Math.max(1, now - lastFpsRef.current)));
      lastFpsRef.current = now;

      const p     = paramsRef.current;
      const video = videoRef.current;
      const side  = Math.min(video.videoWidth, video.videoHeight);
      const size  = p.inputSize;

      const canvas = canvasRef.current;
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      ctx.save();
      if (p.mirrorCam) { ctx.translate(size, 0); ctx.scale(-1, 1); }
      ctx.drawImage(video, (video.videoWidth-side)/2, (video.videoHeight-side)/2, side, side, 0, 0, size, size);
      ctx.restore();
      setLiveThumb(canvas.toDataURL('image/jpeg', 0.55));

      const t0 = performance.now();
      try {
        const emb = await getEmbedding(ctx, size);
        if (emb) {
          const ms = performance.now() - t0;
          setInferenceMs(parseFloat(ms.toFixed(1)));
          setEmbVec(Array.from(emb).slice(0, p.embDimsShown));

          // 1:N matching against whole gallery
          const gl = galleryRef.current;
          if (gl.length > 0) {
            const scores: MatchResult[] = gl.map(f => ({
              face: f,
              similarity: dot(emb, f.embedding),
              match: dot(emb, f.embedding) >= p.threshold,
            })).sort((a,b) => b.similarity - a.similarity);
            setTopMatches(scores);
          } else {
            setTopMatches([]);
          }
        }
      } catch {}

      if (p.showOverlay && overlayRef.current && videoRef.current) drawOverlay();
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, []);

  // ── Enroll current frame ──────────────────────────────────────────────────────
  const enrollFace = async () => {
    if (!canvasRef.current || !modelRef.current) return;
    const p    = paramsRef.current;
    const name = pendingName.trim() || `Person ${galleryRef.current.length + 1}`;
    if (galleryRef.current.length >= p.maxEnrolled) {
      setErrorMsg(`Gallery full (max ${p.maxEnrolled}). Delete a face first.`); return;
    }
    try {
      const ctx = canvasRef.current.getContext('2d')!;
      const emb = await getEmbedding(ctx, p.inputSize);
      if (!emb) return;
      const newFace: EnrolledFace = {
        id:         crypto.randomUUID(),
        name,
        embedding:  emb,
        thumbnail:  canvasRef.current.toDataURL('image/jpeg', 0.85),
        enrolledAt: new Date().toLocaleTimeString(),
      };
      setGallery(g => [...g, newFace]);
      setPendingName('');
    } catch (e: any) { setErrorMsg(`Enroll: ${e.message}`); }
  };

  const deleteFace = (id: string) => {
    setGallery(g => g.filter(f => f.id !== id));
    setTopMatches(m => m.filter(m => m.face.id !== id));
  };

  const saveName = (id: string) => {
    setGallery(g => g.map(f => f.id === id ? { ...f, name: editingName.trim() || f.name } : f));
    setEditingId(null);
  };

  const clearGallery = () => { setGallery([]); setTopMatches([]); };

  // ── Overlay drawing ────────────────────────────────────────────────────────────
  const drawOverlay = () => {
    const canvas = overlayRef.current!; const video = videoRef.current!;
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const p    = paramsRef.current;
    const side = Math.min(canvas.width, canvas.height) * 0.62;
    const x    = (canvas.width  - side) / 2;
    const y    = (canvas.height - side) / 2;
    const top  = topMatchesRef.current;
    const best = top[0];

    const col = best
      ? best.similarity >= p.threshold    ? '#00ff66'
      : best.similarity >= p.threshold*0.85 ? '#ffcc00'
      : '#ff4444'
      : '#ffffff';

    if (p.showBrackets) {
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      const cs = 28;
      [[x,y,1,1],[x+side,y,-1,1],[x,y+side,1,-1],[x+side,y+side,-1,-1]].forEach(([bx,by,dx,dy]) => {
        ctx.beginPath();
        ctx.moveTo(bx,by+dy*cs); ctx.lineTo(bx,by); ctx.lineTo(bx+dx*cs,by);
        ctx.stroke();
      });
    }

    // Best match label
    if (best) {
      const pct = (best.similarity * 100).toFixed(1);
      const label = best.match ? `✓ ${best.face.name}  ${pct}%` : `✗ ${best.face.name}  ${pct}%`;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(x, y - 26, label.length * 8.2 + 12, 22);
      ctx.fillStyle = col;
      ctx.font = 'bold 13px monospace';
      ctx.fillText(label, x + 6, y - 9);
    }

    // All scores mini-list
    if (p.showAllScores && top.length > 1) {
      const listX = x + side + 10;
      top.slice(0, p.topNDisplay).forEach((m, i) => {
        const pct = (m.similarity * 100).toFixed(1);
        const c2  = m.match ? '#00ff66' : m.similarity >= p.threshold*0.85 ? '#ffcc00' : '#ff4444';
        const ly  = y + i * 20;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(listX, ly, 170, 18);
        ctx.fillStyle = c2;
        ctx.font = '11px monospace';
        ctx.fillText(`${pct}%  ${m.face.name}`, listX + 5, ly + 13);
      });
    }
  };

  // ── Math ──────────────────────────────────────────────────────────────────────
  const l2Norm = (v: Float32Array) => {
    let s = 0; for (const x of v) s += x*x;
    const m = Math.sqrt(s); if (m === 0) return v;
    return new Float32Array(Array.from(v).map(x => x/m));
  };
  const dot = (a: Float32Array, b: Float32Array) => {
    let d = 0; for (let i = 0; i < Math.min(a.length,b.length); i++) d += a[i]*b[i]; return d;
  };

  // ── UI helpers ────────────────────────────────────────────────────────────────
  const stCol   = () => ({ ready:'#00ff66', error:'#ff4444', loading:'#ffcc00', idle:'#555' }[status]);
  const simCol  = (s: number, thr: number) =>
    s >= thr    ? '#00ff66' :
    s >= thr*0.9? '#88ff44' :
    s >= thr*0.8? '#ffcc00' : '#ff4444';

  const best = topMatches[0];

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight:'100vh', background:'#000', color:'#fff', fontFamily:'monospace', fontSize:13, boxSizing:'border-box' }}>
      <style>{`
        * { box-sizing: border-box; }
        .fn-root { display: grid; grid-template-columns: 1fr 300px 320px; gap: 0; min-height: 100vh; }
        @media(max-width:1200px){ .fn-root { grid-template-columns: 1fr 280px; } .fn-gallery-col { display:none; } }
        .col { border-right: 1px solid #141414; display: flex; flex-direction: column; }
        .col-hdr { padding: 14px 18px; border-bottom: 1px solid #141414; background: #040404; }
        .col-body { padding: 16px 18px; flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }
        .sec { font-size: 10px; color: #555; text-transform: uppercase; letter-spacing: 1px; border-left: 2px solid #fff; padding-left: 8px; margin-bottom: 10px; font-weight: 700; }
        .pnl { border: 1px solid #141414; background: #040404; padding: 14px; }
        .pnl-sm { border: 1px dashed #141414; padding: 10px 12px; }
        .ml { font-size: 10px; color: #555; text-transform: uppercase; }
        .mv { font-size: 14px; font-weight: 700; margin-top: 2px; }
        .row { display: flex; justify-content: space-between; align-items: center; padding: 5px 0; border-bottom: 1px solid #0c0c0c; font-size: 11px; }
        .row:last-child { border: none; }
        .bw { background:#fff; color:#000; border:none; padding:8px 14px; font-family:monospace; font-weight:700; font-size:11px; cursor:pointer; letter-spacing:1px; }
        .bw:hover{background:#ccc} .bw:disabled{opacity:.4;cursor:default}
        .bo { background:none; color:#fff; border:1px solid #2a2a2a; padding:8px 14px; font-family:monospace; font-size:11px; cursor:pointer; }
        .bo:hover{border-color:#fff} .bo:disabled{opacity:.4;cursor:default}
        .be { background:none; color:#00ff66; border:1px solid #00ff66; padding:8px 14px; font-family:monospace; font-size:11px; cursor:pointer; }
        .be:hover{background:rgba(0,255,102,0.07)}
        .br { background:none; color:#ff4444; border:1px solid #ff4444; padding:5px 10px; font-family:monospace; font-size:10px; cursor:pointer; }
        .br:hover{background:rgba(255,68,68,0.08)}
        .slider-wrap { display:flex; flex-direction:column; gap:3px; margin-bottom:10px; }
        .slider-lbl { display:flex; justify-content:space-between; font-size:10px; color:#888; }
        input[type=range] { width:100%; height:3px; accent-color:#fff; cursor:pointer; }
        input[type=checkbox] { accent-color:#fff; cursor:pointer; }
        select { background:#0a0a0a; color:#fff; border:1px solid #222; padding:4px 8px; font-family:monospace; font-size:11px; outline:none; cursor:pointer; width:100%; }
        input[type=text] { background:#0a0a0a; color:#fff; border:1px solid #222; padding:6px 10px; font-family:monospace; font-size:11px; outline:none; width:100%; }
        input[type=text]:focus { border-color:#fff; }
        .ebar { display:flex; gap:2px; align-items:flex-end; height:38px; }
        .ebar span { flex:1; min-width:2px; transition:height .07s; }
        .face-card { display:flex; gap:10px; align-items:flex-start; padding:10px; border:1px solid #141414; background:#060606; margin-bottom:8px; position:relative; }
        .face-card:hover { border-color:#1e1e1e; }
        .face-name { font-size:12px; font-weight:700; color:#fff; }
        .face-meta { font-size:10px; color:#444; margin-top:2px; }
        .match-bar-bg { background:#111; height:4px; margin-top:4px; }
        .match-bar { height:4px; transition:width .1s; }
        .scrollable { max-height: calc(100vh - 200px); overflow-y: auto; }
        .scrollable::-webkit-scrollbar { width: 4px; } .scrollable::-webkit-scrollbar-thumb { background:#222; }
      `}</style>

      {/* ── TOP HEADER ─────────────────────────────────────────────────────────── */}
      <div style={{ borderBottom:'1px solid #141414', background:'#020202', padding:'12px 20px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div>
          <h1 style={{ fontSize:16, fontWeight:700, letterSpacing:2, margin:0 }}>MOBILEFACENET INFERENCE LAB</h1>
          <span style={{ fontSize:10, color:'#444', letterSpacing:1 }}>
            {DEFAULT_DIM}-DIM EMBEDDING · 1:N GALLERY MATCHING · COSINE SIMILARITY · 100% OFFLINE
          </span>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:14 }}>
          <span style={{ fontSize:11, display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ width:6, height:6, borderRadius:'50%', background:stCol(), display:'inline-block' }} />
            {status.toUpperCase()}
            {cameraActive && <span style={{ color:'#00f0ff', marginLeft:8 }}>{fps}fps · {inferenceMs}ms</span>}
          </span>
          <button className="bo" onClick={() => { window.location.search = ''; }}>← Exit</button>
        </div>
      </div>

      <div className="fn-root">

        {/* ══════════════════════════════════════════════════════════════════════
            COL 1: Camera Viewport
        ══════════════════════════════════════════════════════════════════════ */}
        <div className="col">
          <div className="col-hdr" style={{ fontSize:11, color:'#555' }}>LIVE CAMERA  ·  {params.inputSize}×{params.inputSize} INPUT</div>
          <div className="col-body">

            {/* Viewport */}
            <div style={{ position:'relative', background:'#050505', border:'1px solid #141414', aspectRatio:'4/3', overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center' }}>
              <div style={{ position:'relative', width:'100%', height:'100%', transform: params.mirrorCam ? 'scaleX(-1)' : 'none', display: cameraActive ? 'block' : 'none' }}>
                <video ref={videoRef} autoPlay playsInline muted style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover' }} />
                <canvas ref={overlayRef} style={{ position:'absolute', inset:0, width:'100%', height:'100%', pointerEvents:'none', display: params.showOverlay ? 'block' : 'none' }} />
              </div>
              <canvas ref={canvasRef} style={{ display:'none' }} />
              {!cameraActive && <div style={{ textAlign:'center', color:'#333', fontSize:12 }}>
                {status !== 'ready' ? '→ Load model first' : '📷 Start camera to begin'}
              </div>}
            </div>

            {/* Buttons */}
            <div style={{ display:'flex', gap:8 }}>
              {status !== 'ready' ? (
                <button className="bw" style={{ flex:1 }} onClick={loadModel} disabled={status==='loading'}>
                  {status==='loading' ? '⏳ Loading 5MB...' : '🚀 Load MobileFaceNet'}
                </button>
              ) : !cameraActive ? (
                <button className="bw" style={{ flex:1 }} onClick={startCamera}>📷 Start Camera</button>
              ) : (
                <button className="bo" style={{ flex:1 }} onClick={stopCamera}>🛑 Stop Camera</button>
              )}
            </div>

            {errorMsg && <div style={{ color:'#ff4444', fontSize:11, background:'#120000', border:'1px solid #330000', padding:'8px 12px' }}>{errorMsg}</div>}

            {/* Enroll section */}
            {cameraActive && (
              <div className="pnl">
                <div className="sec">Enroll Live Face</div>
                <div style={{ display:'flex', gap:8, marginBottom:8 }}>
                  <input
                    type="text"
                    placeholder={`Name (default: Person ${gallery.length+1})`}
                    value={pendingName}
                    onChange={e => setPendingName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && enrollFace()}
                    style={{ flex:1 }}
                  />
                  <button className="be" onClick={enrollFace}>📌 Enroll</button>
                </div>
                <div style={{ fontSize:10, color:'#444' }}>{gallery.length}/{params.maxEnrolled} enrolled · Enter or click Enroll</div>
              </div>
            )}

            {/* Live embedding */}
            <div className="pnl">
              <div className="sec">Live Embedding Vector ({params.embDimsShown}/{DEFAULT_DIM} dims shown)</div>
              {embVec.length > 0 ? <>
                <div className="ebar">
                  {embVec.map((v, i) => (
                    <span key={i} style={{ height:`${Math.max(3, Math.abs(v)*100)}%`, background: v > 0 ? '#00f0ff' : '#ff4444' }} title={`[${i}]: ${v.toFixed(4)}`} />
                  ))}
                </div>
                <div style={{ fontSize:10, color:'#2a2a2a', marginTop:4 }}>Cyan = + · Red = − · Height = magnitude</div>
              </> : <div style={{ fontSize:11, color:'#2a2a2a' }}>Start camera to see embedding.</div>}
            </div>

            {/* Top matches live list */}
            {topMatches.length > 0 && (
              <div className="pnl">
                <div className="sec">Live 1:N Match Results</div>
                {topMatches.slice(0, params.topNDisplay).map((m, i) => (
                  <div key={m.face.id} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                    <span style={{ fontSize:10, color:'#444', width:14 }}>{i+1}</span>
                    <img src={m.face.thumbnail} style={{ width:32, height:32, objectFit:'cover', border:'1px solid #1a1a1a' }} alt="" />
                    <div style={{ flex:1 }}>
                      <div style={{ display:'flex', justifyContent:'space-between' }}>
                        <span style={{ fontSize:11, fontWeight:700, color: m.match ? '#00ff66' : '#fff' }}>{m.face.name}</span>
                        <span style={{ fontSize:11, fontWeight:700, color: simCol(m.similarity, params.threshold) }}>
                          {(m.similarity*100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="match-bar-bg">
                        <div className="match-bar" style={{ width:`${Math.max(0,Math.min(100,m.similarity*100))}%`, background: simCol(m.similarity, params.threshold) }} />
                      </div>
                    </div>
                    {m.match && <span style={{ fontSize:10, color:'#00ff66' }}>✓</span>}
                  </div>
                ))}
                {best && (
                  <div style={{ marginTop:10, padding:'8px 12px', background: best.match ? 'rgba(0,255,102,0.06)' : 'rgba(255,68,68,0.06)', border:`1px solid ${best.match ? '#00ff6655':'#ff444455'}` }}>
                    <span style={{ color: best.match ? '#00ff66' : '#ff4444', fontWeight:700, fontSize:13 }}>
                      {best.match ? `✓ VERIFIED: ${best.face.name}` : '✗ NO MATCH'} · {(best.similarity*100).toFixed(1)}%
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Model info */}
            {modelInfo && (
              <div className="pnl">
                <div className="sec">Model Info</div>
                {Object.entries(modelInfo).map(([k,v]) => (
                  <div className="row" key={k}>
                    <span style={{ color:'#555' }}>{k}</span>
                    <span style={{ color:'#ccc', textAlign:'right', maxWidth:'55%', wordBreak:'break-all' }}>{v}</span>
                  </div>
                ))}
              </div>
            )}

          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            COL 2: Parameters & Controls
        ══════════════════════════════════════════════════════════════════════ */}
        <div className="col">
          <div className="col-hdr" style={{ fontSize:11, color:'#555' }}>PARAMETERS &amp; CONTROLS</div>
          <div className="col-body">

            {/* ── Inference params ─────────────────────────────────────────── */}
            <div className="pnl">
              <div className="sec">Inference</div>

              <div className="slider-wrap">
                <div className="slider-lbl">
                  <span>Match Threshold</span>
                  <span style={{ color:'#fff', fontWeight:700 }}>{(params.threshold*100).toFixed(0)}%</span>
                </div>
                <input type="range" min={0.4} max={0.95} step={0.01} value={params.threshold}
                  onChange={e => setParam('threshold', parseFloat(e.target.value))} />
                <div style={{ fontSize:10, color:'#333' }}>Default 72% · higher = stricter</div>
              </div>

              <div className="slider-wrap">
                <div className="slider-lbl">
                  <span>Input Resolution</span>
                  <span style={{ color:'#fff', fontWeight:700 }}>{params.inputSize}px</span>
                </div>
                <select value={params.inputSize} onChange={e => setParam('inputSize', parseInt(e.target.value))}>
                  <option value={112}>112×112 (default, fast)</option>
                  <option value={160}>160×160 (higher quality)</option>
                </select>
              </div>

              <div className="slider-wrap">
                <div className="slider-lbl"><span>Input Normalization</span></div>
                <select value={params.normMode} onChange={e => setParam('normMode', e.target.value as any)}>
                  <option value="neg1to1">[-1, 1]  pixel/127.5 − 1 (recommended)</option>
                  <option value="0to1">[0, 1]  pixel/255</option>
                </select>
              </div>
            </div>

            {/* ── Display params ───────────────────────────────────────────── */}
            <div className="pnl">
              <div className="sec">Display</div>

              <div className="slider-wrap">
                <div className="slider-lbl">
                  <span>Embedding Dims Shown</span>
                  <span style={{ color:'#fff', fontWeight:700 }}>{params.embDimsShown}</span>
                </div>
                <select value={params.embDimsShown} onChange={e => setParam('embDimsShown', parseInt(e.target.value))}>
                  <option value={8}>8 dims</option>
                  <option value={16}>16 dims</option>
                  <option value={32}>32 dims</option>
                  <option value={64}>64 dims</option>
                  <option value={128}>128 dims</option>
                  <option value={192}>192 dims (all)</option>
                </select>
              </div>

              <div className="slider-wrap">
                <div className="slider-lbl">
                  <span>Top-N Matches Shown</span>
                  <span style={{ color:'#fff', fontWeight:700 }}>{params.topNDisplay}</span>
                </div>
                <input type="range" min={1} max={10} step={1} value={params.topNDisplay}
                  onChange={e => setParam('topNDisplay', parseInt(e.target.value))} />
              </div>

              {[
                ['Mirror Camera',       'mirrorCam',     params.mirrorCam]     as const,
                ['Show Overlay',        'showOverlay',   params.showOverlay]   as const,
                ['Show Brackets',       'showBrackets',  params.showBrackets]  as const,
                ['Overlay Score List',  'showAllScores', params.showAllScores] as const,
              ].map(([label, key, val]) => (
                <label key={key} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'6px 0', borderBottom:'1px solid #0c0c0c', cursor:'pointer', fontSize:11 }}>
                  <span style={{ color:'#999' }}>{label}</span>
                  <input type="checkbox" checked={val} onChange={e => setParam(key as any, e.target.checked)} />
                </label>
              ))}
            </div>

            {/* ── Gallery params ───────────────────────────────────────────── */}
            <div className="pnl">
              <div className="sec">Gallery</div>
              <div className="slider-wrap">
                <div className="slider-lbl">
                  <span>Max Enrolled Faces</span>
                  <span style={{ color:'#fff', fontWeight:700 }}>{params.maxEnrolled}</span>
                </div>
                <input type="range" min={1} max={50} step={1} value={params.maxEnrolled}
                  onChange={e => setParam('maxEnrolled', parseInt(e.target.value))} />
              </div>
              <div style={{ display:'flex', gap:8, marginTop:4 }}>
                <button className="br" style={{ flex:1 }} onClick={clearGallery} disabled={gallery.length===0}>
                  🗑 Clear All ({gallery.length})
                </button>
              </div>
            </div>

            {/* ── Live metrics ─────────────────────────────────────────────── */}
            <div className="pnl">
              <div className="sec">Live Performance</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                {[
                  ['FPS',        String(fps||'–'),               '#fff'],
                  ['Inference',  inferenceMs ? `${inferenceMs}ms` : '–', '#00f0ff'],
                  ['Gallery',    `${gallery.length} faces`,      '#fff'],
                  ['Best Match', best ? `${(best.similarity*100).toFixed(1)}%` : '–', best ? simCol(best.similarity, params.threshold) : '#555'],
                  ['Verified',   best?.match ? best.face.name : 'None', best?.match ? '#00ff66' : '#555'],
                  ['Threshold',  `${(params.threshold*100).toFixed(0)}%`, '#fff'],
                ].map(([l,v,c]) => (
                  <div className="pnl-sm" key={l as string}>
                    <div className="ml">{l}</div>
                    <div className="mv" style={{ color:c as string, fontSize:13 }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Pipeline note ────────────────────────────────────────────── */}
            <div className="pnl" style={{ fontSize:11, color:'#333', lineHeight:1.85 }}>
              <div className="sec">NHAI Pipeline Role</div>
              <div style={{ marginBottom:8 }}><span style={{ color:'#00f0ff' }}>① FaceMesh</span><br />Liveness → EAR/MAR/pose → 112×112 crop</div>
              <div style={{ marginBottom:8 }}><span style={{ color:'#00ff66' }}>② MobileFaceNet ← HERE</span><br />{DEFAULT_DIM}-dim embedding → 1:N gallery match</div>
              <div><span style={{ color:'#ffcc00' }}>③ Decision</span><br />≥{(params.threshold*100).toFixed(0)}% → gate access granted</div>
            </div>

          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            COL 3: Enrolled Face Gallery
        ══════════════════════════════════════════════════════════════════════ */}
        <div className="col fn-gallery-col">
          <div className="col-hdr" style={{ fontSize:11, color:'#555', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span>ENROLLED GALLERY  ·  {gallery.length}/{params.maxEnrolled}</span>
            {gallery.length > 0 && <button className="br" onClick={clearGallery} style={{ fontSize:10, padding:'3px 8px' }}>Clear All</button>}
          </div>
          <div className="col-body scrollable">

            {gallery.length === 0 ? (
              <div style={{ textAlign:'center', color:'#2a2a2a', fontSize:12, padding:'40px 0' }}>
                No faces enrolled.<br/>Start camera and click 📌 Enroll.
              </div>
            ) : (
              [...gallery].reverse().map(face => {
                const myMatch = topMatches.find(m => m.face.id === face.id);
                return (
                  <div className="face-card" key={face.id}>
                    <img src={face.thumbnail} style={{ width:56, height:56, objectFit:'cover', border:'1px solid #1a1a1a', flexShrink:0 }} alt={face.name} />
                    <div style={{ flex:1, minWidth:0 }}>
                      {editingId === face.id ? (
                        <div style={{ display:'flex', gap:6 }}>
                          <input type="text" value={editingName} onChange={e => setEditingName(e.target.value)}
                            onKeyDown={e => { if(e.key==='Enter') saveName(face.id); if(e.key==='Escape') setEditingId(null); }}
                            autoFocus style={{ flex:1, padding:'3px 6px', fontSize:11 }} />
                          <button className="bw" style={{ padding:'3px 8px', fontSize:10 }} onClick={() => saveName(face.id)}>✓</button>
                        </div>
                      ) : (
                        <div className="face-name" style={{ cursor:'pointer', color: myMatch?.match ? '#00ff66' : '#fff' }}
                          onClick={() => { setEditingId(face.id); setEditingName(face.name); }}>
                          {face.name}
                          <span style={{ fontSize:9, color:'#333', marginLeft:6 }}>✏</span>
                        </div>
                      )}
                      <div className="face-meta">{face.enrolledAt} · {DEFAULT_DIM}-dim</div>
                      {myMatch && <>
                        <div style={{ display:'flex', justifyContent:'space-between', marginTop:4, fontSize:10 }}>
                          <span style={{ color:simCol(myMatch.similarity, params.threshold) }}>
                            {myMatch.match ? '✓ MATCH' : '✗ NO MATCH'}
                          </span>
                          <span style={{ color:simCol(myMatch.similarity, params.threshold), fontWeight:700 }}>
                            {(myMatch.similarity*100).toFixed(1)}%
                          </span>
                        </div>
                        <div className="match-bar-bg">
                          <div className="match-bar" style={{ width:`${Math.max(0,Math.min(100,myMatch.similarity*100))}%`, background:simCol(myMatch.similarity, params.threshold) }} />
                        </div>
                      </>}
                    </div>
                    <button className="br" onClick={() => deleteFace(face.id)} style={{ fontSize:10, padding:'3px 7px', flexShrink:0, alignSelf:'flex-start' }}>✕</button>
                  </div>
                );
              })
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
