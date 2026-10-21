import { useQuery } from "@tanstack/react-query";
import api from "../services/api";
import { MapPin } from "lucide-react";
import { Badge } from "../components/ui";
import { env } from "../config/env";

export default function ZonesPage() {
  const { data: zones, isLoading } = useQuery({
    queryKey: ["zones"],
    queryFn: async () => {
      try {
        const { data } = await api.get("/zones", { baseURL: env.AI_URL });
        return data as any[];
      } catch {
        return [];
      }
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MapPin className="h-5 w-5 text-purple-400" />
          <h2 className="text-lg font-bold text-foreground">Zones</h2>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          <p className="text-muted-foreground text-xs col-span-full text-center py-8">Loading zones...</p>
        ) : !zones?.length ? (
          <div className="col-span-full rounded-lg border border-border bg-[hsl(var(--card))] p-8 text-center">
            <MapPin className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No zones configured</p>
            <p className="text-xs text-muted-foreground mt-1">Create zones via the AI Engine API or the zone editor</p>
          </div>
        ) : (
          zones.map((z: any, i: number) => (
            <div key={z.id || i} className="rounded-lg border border-border bg-[hsl(var(--card))] p-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-medium text-foreground">{z.name}</h4>
                <Badge variant={z.type === "RESTRICTED" ? "danger" : "success"}>
                  {z.type || "GENERAL"}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                Polygon points: {z.polygon?.length ?? 0}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
