import { Activity } from "lucide-react";
import { useEventStore } from "../stores/eventStore";
import { formatTimestamp } from "../utils";

export default function EventsPage() {
  const liveEvents = useEventStore((s) => s.liveEvents);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Activity className="h-5 w-5 text-green-400" />
        <h2 className="text-lg font-bold text-foreground">AI Events</h2>
        <span className="text-xs text-muted-foreground ml-2">({liveEvents.length} events in session)</span>
      </div>

      <div className="rounded-lg border border-border bg-[hsl(var(--card))] overflow-hidden">
        {liveEvents.length === 0 ? (
          <div className="p-8 text-center">
            <Activity className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No AI events received in this session</p>
            <p className="text-xs text-muted-foreground mt-1">Connect a camera and start streaming to receive real events</p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-secondary/50">
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Time</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Event Type</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Confidence</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Worker</th>
              </tr>
            </thead>
            <tbody>
              {liveEvents.map((ev, i) => (
                <tr key={i} className="border-b border-border">
                  <td className="px-4 py-2.5 font-mono text-muted-foreground">
                    {ev.timestamp ? formatTimestamp(ev.timestamp) : "--:--:--"}
                  </td>
                  <td className="px-4 py-2.5 text-foreground font-medium">{ev.eventType}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {ev.confidence ? `${(ev.confidence * 100).toFixed(0)}%` : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-blue-400">{ev.workerId || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
