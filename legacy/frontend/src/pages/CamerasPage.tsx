import { Camera } from "lucide-react";
import { Badge } from "../components/ui";

export default function CamerasPage() {
  // In the demo, we only have the mobile camera. Real cameras come from backend.
  const cameras = [
    {
      name: "Mobile Camera (Demo)",
      area: "Mobile / Demo",
      sourceType: "DEMO_PHONE",
      status: "READY",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Camera className="h-5 w-5 text-cyan-400" />
        <h2 className="text-lg font-bold text-foreground">Cameras</h2>
      </div>

      <div className="rounded-lg border border-border bg-[hsl(var(--card))] overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-secondary/50">
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Camera Name</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Area</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Source Type</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody>
            {cameras.map((c, i) => (
              <tr key={i} className="border-b border-border">
                <td className="px-4 py-2.5 text-foreground font-medium">{c.name}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{c.area}</td>
                <td className="px-4 py-2.5">
                  <Badge variant="warning">DEMO CAMERA</Badge>
                </td>
                <td className="px-4 py-2.5">
                  <Badge variant="success">{c.status}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
