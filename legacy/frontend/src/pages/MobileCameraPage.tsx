import { useEffect, useRef, useState, useCallback } from "react";
import { env } from "../config/env";
import { Smartphone, CameraOff, SwitchCamera } from "lucide-react";
import { StatusIndicator, Badge } from "../components/ui";

const DEFAULT_FPS = 12;
const DEFAULT_QUALITY = 0.75;
const DEFAULT_WIDTH = 640;
const DEFAULT_HEIGHT = 480;

interface Detection {
  class_name: string;
  confidence: number;
  track_id?: number;
  face_id?: string;
  bbox: { x1: number; y1: number; x2: number; y2: number };
}

export default function MobileCameraPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const intervalRef = useRef<number | null>(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [error, setError] = useState("");
  const [detections, setDetections] = useState<Detection[]>([]);
  const [fps, setFps] = useState(DEFAULT_FPS);
  const [quality, setQuality] = useState(DEFAULT_QUALITY);

  const startCamera = useCallback(async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: DEFAULT_WIDTH }, height: { ideal: DEFAULT_HEIGHT } },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraActive(true);
      }
    } catch (err: any) {
      if (err.name === "NotAllowedError") {
        setError("Camera permission denied. Please allow camera access.");
      } else if (err.name === "NotFoundError") {
        setError("No camera found on this device.");
      } else {
        setError(`Camera error: ${err.message}`);
      }
    }
  }, [facingMode]);

  const stopCamera = useCallback(() => {
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }, []);

  const switchCamera = useCallback(() => {
    stopCamera();
    setFacingMode((prev) => (prev === "environment" ? "user" : "environment"));
  }, [stopCamera]);

  useEffect(() => {
    if (cameraActive) {
      startCamera();
    }
  }, [facingMode]);

  const drawOverlay = useCallback((dets: Detection[]) => {
    const canvas = overlayCanvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    canvas.width = video.videoWidth || DEFAULT_WIDTH;
    canvas.height = video.videoHeight || DEFAULT_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const det of dets) {
      const { x1, y1, x2, y2 } = det.bbox;
      const w = x2 - x1;
      const h = y2 - y1;

      const color = det.face_id ? "#3b82f6" : "#22c55e";
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x1, y1, w, h);

      const label = det.face_id
        ? `${det.face_id} ${(det.confidence * 100).toFixed(0)}%`
        : `${det.class_name} ${(det.confidence * 100).toFixed(0)}%`;

      ctx.font = "bold 12px Inter, sans-serif";
      const textWidth = ctx.measureText(label).width;
      ctx.fillStyle = color;
      ctx.fillRect(x1, Math.max(y1 - 18, 0), textWidth + 8, 18);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, x1 + 4, Math.max(y1 - 4, 14));
    }
  }, []);

  const connectWS = useCallback(() => {
    const wsUrl = env.AI_URL.replace(/^http/, "ws") + "/ws/video-stream";
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setWsConnected(true);
    ws.onclose = () => { setWsConnected(false); setStreaming(false); };
    ws.onerror = () => { setWsConnected(false); setError("Could not connect to AI Engine."); };
    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data.detections) {
          setDetections(data.detections);
          drawOverlay(data.detections);
        }
      } catch { /* ignore */ }
    };
  }, [drawOverlay]);

  const startStreamingLoop = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    const captureCanvas = canvasRef.current;
    const video = videoRef.current;
    if (!captureCanvas || !video) return;

    setStreaming(true);

    intervalRef.current = window.setInterval(() => {
      if (!video.videoWidth || !video.videoHeight) return;
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

      captureCanvas.width = DEFAULT_WIDTH;
      captureCanvas.height = DEFAULT_HEIGHT;
      const ctx = captureCanvas.getContext("2d");
      if (!ctx) return;

      ctx.drawImage(video, 0, 0, DEFAULT_WIDTH, DEFAULT_HEIGHT);
      const dataUrl = captureCanvas.toDataURL("image/jpeg", quality);

      wsRef.current.send(JSON.stringify({ image: dataUrl, cameraId: "mobile-camera" }));
    }, 1000 / fps);
  }, [fps, quality]);

  const stopStreaming = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setStreaming(false);
    setDetections([]);
    if (overlayCanvasRef.current) {
      const ctx = overlayCanvasRef.current.getContext("2d");
      ctx?.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height);
    }
  }, []);

  const handleStartStreaming = useCallback(() => {
    connectWS();
    setTimeout(startStreamingLoop, 500);
  }, [connectWS, startStreamingLoop]);

  useEffect(() => {
    return () => {
      stopStreaming();
      stopCamera();
      wsRef.current?.close();
    };
  }, []);

  return (
    <div className="max-w-lg mx-auto space-y-4 pb-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Smartphone className="h-5 w-5 text-blue-400" />
          <h2 className="text-lg font-bold text-foreground">Mobile Camera</h2>
        </div>
        <div className="flex items-center gap-3">
          <StatusIndicator label="Camera" online={cameraActive} />
          <StatusIndicator label="AI" online={wsConnected} />
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</div>
      )}

      <div className="relative rounded-lg border border-border bg-black overflow-hidden">
        <video ref={videoRef} playsInline muted className="w-full h-auto" style={{ display: cameraActive ? "block" : "none" }} />
        <canvas ref={overlayCanvasRef} className="absolute top-0 left-0 w-full h-full pointer-events-none" />
        {!cameraActive && (
          <div className="flex flex-col items-center justify-center py-24">
            <CameraOff className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">Camera not active</p>
          </div>
        )}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {detections.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {detections.map((d, i) => (
            <Badge key={i} variant={d.class_name === "person" ? "info" : "warning"}>
              {d.face_id || d.class_name} {(d.confidence * 100).toFixed(0)}%
            </Badge>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {!cameraActive ? (
          <button onClick={startCamera} className="col-span-2 rounded-md bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-700 transition-colors">
            Start Camera
          </button>
        ) : (
          <>
            <button onClick={stopCamera} className="rounded-md border border-border bg-secondary px-4 py-3 text-sm font-medium text-foreground hover:bg-secondary/80 transition-colors">Stop Camera</button>
            <button onClick={switchCamera} className="rounded-md border border-border bg-secondary px-4 py-3 text-sm font-medium text-foreground hover:bg-secondary/80 transition-colors flex items-center justify-center gap-2">
              <SwitchCamera className="h-4 w-4" /> Switch
            </button>
          </>
        )}

        {cameraActive && !streaming && (
          <button onClick={handleStartStreaming} className="col-span-2 rounded-md bg-green-600 px-4 py-3 text-sm font-medium text-white hover:bg-green-700 transition-colors">
            Start AI Streaming
          </button>
        )}

        {streaming && (
          <button onClick={stopStreaming} className="col-span-2 rounded-md bg-red-600 px-4 py-3 text-sm font-medium text-white hover:bg-red-700 transition-colors">
            Stop Streaming
          </button>
        )}
      </div>

      <div className="rounded-lg border border-border bg-[hsl(var(--card))] p-4 space-y-3">
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Stream Settings</h3>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">FPS</span>
          <input type="range" min={5} max={30} value={fps} onChange={(e) => setFps(Number(e.target.value))} className="w-32" />
          <span className="text-xs text-foreground w-8 text-right">{fps}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Quality</span>
          <input type="range" min={30} max={95} value={quality * 100} onChange={(e) => setQuality(Number(e.target.value) / 100)} className="w-32" />
          <span className="text-xs text-foreground w-8 text-right">{(quality * 100).toFixed(0)}%</span>
        </div>
        <div className="text-[10px] text-muted-foreground">Resolution: {DEFAULT_WIDTH}×{DEFAULT_HEIGHT}</div>
      </div>
    </div>
  );
}
