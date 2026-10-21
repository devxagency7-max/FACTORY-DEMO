import { useQuery } from "@tanstack/react-query";
import api from "../services/api";
import type { Worker } from "../types";
import { useNavigate } from "react-router-dom";
import { Users, Search } from "lucide-react";
import { Badge } from "../components/ui";
import { useState } from "react";

export default function WorkersPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const { data: workers, isLoading } = useQuery({
    queryKey: ["workers"],
    queryFn: async () => {
      try {
        const { data } = await api.get<Worker[]>("/api/workers");
        return data;
      } catch {
        return [];
      }
    },
  });

  const filtered = workers?.filter((w) =>
    w.fullName?.toLowerCase().includes(search.toLowerCase()) ||
    w.employeeCode?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-blue-400" />
          <h2 className="text-lg font-bold text-foreground">Workers</h2>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search workers..."
            className="rounded-md border border-border bg-input pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring w-56"
          />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-[hsl(var(--card))] overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-secondary/50">
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Employee ID</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Name</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Position</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">Loading...</td></tr>
            ) : !filtered?.length ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                {workers?.length === 0 ? "No workers endpoint available yet." : "No matching workers."}
              </td></tr>
            ) : (
              filtered.map((w) => (
                <tr
                  key={w.id}
                  onClick={() => navigate(`/workers/${w.id}`)}
                  className="border-b border-border hover:bg-secondary/30 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-2.5 font-mono text-blue-400">{w.employeeCode}</td>
                  <td className="px-4 py-2.5 text-foreground font-medium">{w.fullName}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{w.position}</td>
                  <td className="px-4 py-2.5">
                    <Badge variant={w.status === "ACTIVE" ? "success" : "default"}>{w.status}</Badge>
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
