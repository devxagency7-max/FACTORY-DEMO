import { Settings } from "lucide-react";
import { env } from "../config/env";

export default function SettingsPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-2">
        <Settings className="h-5 w-5 text-gray-400" />
        <h2 className="text-lg font-bold text-foreground">Settings</h2>
      </div>

      <div className="rounded-lg border border-border bg-[hsl(var(--card))] p-4 space-y-4">
        <h3 className="text-sm font-bold text-foreground">Connection Configuration</h3>
        <div className="grid gap-3 text-xs">
          <div className="flex justify-between items-center border-b border-border pb-2">
            <span className="text-muted-foreground">Backend API URL</span>
            <span className="font-mono text-foreground">{env.API_URL}</span>
          </div>
          <div className="flex justify-between items-center border-b border-border pb-2">
            <span className="text-muted-foreground">SignalR Hub URL</span>
            <span className="font-mono text-foreground">{env.SIGNALR_URL}</span>
          </div>
          <div className="flex justify-between items-center border-b border-border pb-2">
            <span className="text-muted-foreground">AI Engine URL</span>
            <span className="font-mono text-foreground">{env.AI_URL}</span>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground">
          These values are set via environment variables (VITE_API_URL, VITE_SIGNALR_URL, VITE_AI_URL).
          Update your .env file and restart the dev server to change them.
        </p>
      </div>
    </div>
  );
}
