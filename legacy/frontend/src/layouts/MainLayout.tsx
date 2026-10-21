import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { useCallback } from "react";
import { useSignalR } from "../hooks/useSignalR";
import { useEventStore } from "../stores/eventStore";
import { StatusIndicator } from "../components/ui";

export function MainLayout() {
  const addEvent = useEventStore((s) => s.addEvent);

  const handleEvent = useCallback((data: any) => {
    addEvent(data);
  }, [addEvent]);

  const { isConnected: signalRConnected } = useSignalR("AI_EVENT_RECEIVED", handleEvent);

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 ml-56">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-border bg-[hsl(220,25%,10%)]/90 backdrop-blur px-6">
          <h1 className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">
            Factory Command Center
          </h1>
          <div className="flex items-center gap-4">
            <StatusIndicator label="SignalR" online={signalRConnected} />
            <StatusIndicator label="Backend" online={true} />
          </div>
        </header>

        {/* Page Content */}
        <main className="p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
