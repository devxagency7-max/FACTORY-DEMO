import { useEffect, useRef, useState, useCallback } from "react";
import { env } from "../config/env";
import { useEventStore } from "../stores/eventStore";
import { StatusIndicator, Badge } from "../components/ui";
import { formatTimestamp } from "../utils";
import { Radio, AlertTriangle, Activity } from "lucide-react";

interface Detection {
  class_name: string;
  confidence: number;
  track_id?: number;
  face_id?: string;
  bbox: { x1: number; y1: number; x2: number; y2: number };
}

export default function LivePage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [detections, setDetections] = useState<Detection[]>([]);
  const liveEvents = useEventStore((s) => s.liveEvents);

  const connectToLive = useCallback(() => {
    const wsUrl = env.AI_URL.replace(/^http/, "ws") + "/ws/live";
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);

    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data.image && canvasRef.current) {
          const img = new Image();
          img.onload = () => {
            const ctx = canvasRef.current!.getContext("2d");
            if (ctx) {
              canvasRef.current!.width = img.width;
              canvasRef.current!.height = img.height;
              ctx.drawImage(img, 0, 0);
            }
          };
          img.src = "data:image/jpeg;base64," + data.image;
        }
        if (data.detections) {
          setDetections(data.detections);
        }
      } catch (e) {
        console.error("Live WS parse error", e);
      }
    };

    return () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    const cleanup = connectToLive();
    return cleanup;
  }, [connectToLive]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Radio className="h-5 w-5 text-red-400 animate-pulse" />
          <h2 className="text-lg font-bold text-foreground">Live Monitoring</h2>
          {connected && <Badge variant="success">LIVE</Badge>}
        </div>
        <StatusIndicator label="AI Engine Feed" online={connected} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <div className="rounded-lg border border-border bg-black overflow-hidden relative">
            <canvas ref={canvasRef} className="w-full h-auto min-h-[400px] bg-black" />
            {!connected && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                <div className="text-center">
                  <Radio className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No live feed available</p>
                  <p className="text-xs text-muted-foreground mt-1">Connect a camera source or start the AI Engine</p>
                </div>
              </div>
            )}
          </div>

          <div className="mt-3 flex gap-2 flex-wrap">
            {detections.map((d, i) => (
              <Badge key={i} variant={d.class_name === "person" ? "info" : "warning"}>
                {d.class_name} {d.confidence ? `${(d.confidence * 100).toFixed(0)}%` : ""}
                {d.face_id ? ` [${d.face_id}]` : d.track_id !== undefined ? ` #${d.track_id}` : ""}
              </Badge>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-[hsl(var(--card))] p-4 max-h-[600px] overflow-y-auto">
          <h3 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Real-Time Event Feed
          </h3>
          {liveEvents.length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center">Waiting for AI events...</p>
          ) : (
            <div className="space-y-2">
              {liveEvents.map((ev, i) => (
                <div key={i} className="rounded border border-border bg-background p-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {ev.timestamp ? formatTimestamp(ev.timestamp) : "--:--:--"}
                    </span>
                    {ev.eventType?.includes("UNAUTHORIZED") && (
                      <AlertTriangle className="h-3 w-3 text-red-400" />
                    )}
                  </div>
                  <div className="text-xs font-medium text-foreground">{ev.eventType}</div>
                  {ev.workerId && (
                    <div className="text-[10px] text-blue-400 mt-0.5">Worker: {ev.workerId}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
