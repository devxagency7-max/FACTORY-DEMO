import { useQuery } from "@tanstack/react-query";
import { dashboardService } from "../services/api";
import { KPICard } from "../components/ui";
import { useEventStore } from "../stores/eventStore";
import {
  Users,
  AlertTriangle,
  Camera,
  Activity,
  Shield,
  Monitor,
  Cpu,
  TrendingUp,
} from "lucide-react";

export default function DashboardPage() {
  const liveEvents = useEventStore((s) => s.liveEvents);

  const { data: overview, isLoading } = useQuery({
    queryKey: ["dashboard-overview"],
    queryFn: dashboardService.getOverview,
    refetchInterval: 10000,
    retry: 1,
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">Factory Command Center</h2>
          <p className="text-xs text-muted-foreground">Real-time factory monitoring overview</p>
        </div>
        <div className="text-xs text-muted-foreground">
          AI Events Today: <span className="font-bold text-blue-400">{liveEvents.length}</span>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard
          title="Total Workers"
          value={isLoading ? "..." : overview?.activeWorkers ?? "N/A"}
          icon={<Users className="h-4 w-4" />}
          subtitle="Registered in system"
        />
        <KPICard
          title="Active Cameras"
          value={isLoading ? "..." : overview?.activeCameras ?? "N/A"}
          icon={<Camera className="h-4 w-4" />}
          subtitle="Connected feeds"
        />
        <KPICard
          title="AI Events Today"
          value={liveEvents.length}
          icon={<Activity className="h-4 w-4" />}
          subtitle="Real-time detections"
        />
        <KPICard
          title="Open Violations"
          value={isLoading ? "..." : overview?.pendingViolations ?? "N/A"}
          icon={<AlertTriangle className="h-4 w-4" />}
          subtitle="Pending review"
        />
        <KPICard
          title="Safety Alerts"
          value={liveEvents.filter(e => e.eventType?.includes("PPE") || e.eventType?.includes("UNAUTHORIZED")).length}
          icon={<Shield className="h-4 w-4" />}
          subtitle="From AI engine"
        />
        <KPICard
          title="Machines Online"
          value="—"
          icon={<Cpu className="h-4 w-4" />}
          subtitle="Coming in Phase 4"
        />
        <KPICard
          title="Production Efficiency"
          value="—"
          icon={<TrendingUp className="h-4 w-4" />}
          subtitle="Coming in Phase 4"
        />
        <KPICard
          title="Present Workers"
          value="—"
          icon={<Monitor className="h-4 w-4" />}
          subtitle="Coming in Phase 4"
        />
      </div>

      {/* Recent Events */}
      <div className="rounded-lg border border-border bg-[hsl(var(--card))] p-4">
        <h3 className="text-sm font-bold text-foreground mb-3">Recent AI Events</h3>
        {liveEvents.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">
            No live events yet. Connect a camera to start receiving AI detections.
          </p>
        ) : (
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {liveEvents.slice(0, 10).map((ev, i) => (
              <div key={i} className="flex items-center gap-3 rounded border border-border bg-background px-3 py-2 text-xs">
                <span className="text-muted-foreground font-mono">
                  {ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString("en-US", { hour12: false }) : "--:--:--"}
                </span>
                <span className="font-medium text-foreground">{ev.eventType}</span>
                {ev.workerId && <span className="text-blue-400">Worker: {ev.workerId}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
