import { useQuery } from "@tanstack/react-query";
import { dashboardService } from "../services/api";
import { Badge } from "../components/ui";
import { severityLabel, severityColor, violationStatusLabel, violationStatusColor, formatTimestamp } from "../utils";
import { AlertTriangle, Filter } from "lucide-react";
import { useState } from "react";
import api from "../services/api";

export default function ViolationsPage() {
  const [statusFilter, setStatusFilter] = useState<number | null>(null);

  const { data: violations, isLoading, refetch } = useQuery({
    queryKey: ["violations"],
    queryFn: dashboardService.getViolations,
  });

  const filtered = violations?.filter((v) =>
    statusFilter === null ? true : v.status === statusFilter
  );

  const handleAction = async (id: string, action: "confirm" | "dismiss") => {
    try {
      const newStatus = action === "confirm" ? 1 : 2;
      await api.put(`/api/violations/${id}/status`, { status: newStatus });
      refetch();
    } catch {
      alert("This action requires the Phase 2 violation update endpoint.");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-orange-400" />
          <h2 className="text-lg font-bold text-foreground">Violations</h2>
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <select
            value={statusFilter ?? ""}
            onChange={(e) => setStatusFilter(e.target.value === "" ? null : Number(e.target.value))}
            className="rounded border border-border bg-input px-2 py-1 text-xs text-foreground"
          >
            <option value="">All Status</option>
            <option value="0">Pending</option>
            <option value="1">Confirmed</option>
            <option value="2">Dismissed</option>
            <option value="3">Resolved</option>
          </select>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-[hsl(var(--card))] overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-secondary/50">
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Worker</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Violation</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Severity</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Detected</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Status</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Loading...</td></tr>
            ) : !filtered?.length ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No violations found</td></tr>
            ) : (
              filtered.map((v) => (
                <tr key={v.id} className="border-b border-border hover:bg-secondary/30 cursor-pointer transition-colors">
                  <td className="px-4 py-2.5 text-foreground">{v.worker?.fullName ?? v.workerId ?? "—"}</td>
                  <td className="px-4 py-2.5 text-foreground">{v.type}</td>
                  <td className="px-4 py-2.5">
                    <span className={severityColor(v.severity)}>{severityLabel(v.severity)}</span>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground font-mono">{formatTimestamp(v.detectedAt)}</td>
                  <td className="px-4 py-2.5">
                    <Badge className={violationStatusColor(v.status)}>
                      {violationStatusLabel(v.status)}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    {v.status === 0 && (
                      <div className="flex gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleAction(v.id, "confirm"); }}
                          className="rounded bg-red-600/20 px-2 py-0.5 text-red-400 hover:bg-red-600/40 transition-colors"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleAction(v.id, "dismiss"); }}
                          className="rounded bg-gray-600/20 px-2 py-0.5 text-gray-400 hover:bg-gray-600/40 transition-colors"
                        >
                          Dismiss
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
