import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import api from "../services/api";
import type { Worker } from "../types";

export default function WorkerProfilePage() {
  const { id } = useParams<{ id: string }>();

  const { data: worker, isLoading } = useQuery({
    queryKey: ["worker", id],
    queryFn: async () => {
      try {
        const { data } = await api.get<Worker>(`/api/workers/${id}`);
        return data;
      } catch {
        return null;
      }
    },
    enabled: !!id,
  });

  if (isLoading) return <p className="text-muted-foreground text-sm">Loading...</p>;
  if (!worker) return <p className="text-muted-foreground text-sm">Worker not found or API not available.</p>;

  return (
    <div className="max-w-2xl space-y-6">
      <div className="rounded-lg border border-border bg-[hsl(var(--card))] p-6">
        <div className="flex items-start gap-6">
          <div className="h-20 w-20 rounded-lg bg-secondary flex items-center justify-center text-2xl font-bold text-muted-foreground">
            {worker.fullName?.charAt(0) ?? "?"}
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-bold text-foreground">{worker.fullName}</h2>
            <p className="text-sm text-muted-foreground font-mono">{worker.employeeCode}</p>
            <div className="mt-3 grid grid-cols-2 gap-y-2 text-xs">
              <div>
                <span className="text-muted-foreground">Position: </span>
                <span className="text-foreground">{worker.position}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Status: </span>
                <span className="text-green-400">{worker.status}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Department: </span>
                <span className="text-foreground">{worker.departmentId}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-[hsl(var(--card))] p-4">
        <h3 className="text-sm font-bold text-foreground mb-3">Violations History</h3>
        <p className="text-xs text-muted-foreground text-center py-4">
          Violation history will appear here when the worker has violations.
        </p>
      </div>
    </div>
  );
}
