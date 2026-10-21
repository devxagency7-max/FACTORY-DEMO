import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Radio,
  Users,
  AlertTriangle,
  MapPin,
  Camera,
  Activity,
  Settings,
  Smartphone,
  LogOut,
} from "lucide-react";
import { cn } from "../utils";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/live", label: "Live Monitor", icon: Radio },
  { to: "/mobile-camera", label: "Mobile Camera", icon: Smartphone },
  { to: "/workers", label: "Workers", icon: Users },
  { to: "/violations", label: "Violations", icon: AlertTriangle },
  { to: "/zones", label: "Zones", icon: MapPin },
  { to: "/cameras", label: "Cameras", icon: Camera },
  { to: "/events", label: "AI Events", icon: Activity },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-56 border-r border-border bg-[hsl(220,25%,10%)] flex flex-col">
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 py-4 border-b border-border">
        <div className="h-8 w-8 rounded bg-blue-600 flex items-center justify-center">
          <Activity className="h-4 w-4 text-white" />
        </div>
        <div>
          <div className="text-sm font-bold text-foreground tracking-tight">FACTORY AI</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-widest">Command Center</div>
        </div>
      </div>

      {/* DEMO Indicator */}
      <div className="mx-3 mt-3 rounded border border-yellow-500/30 bg-yellow-500/10 px-3 py-1.5 text-center">
        <span className="text-[10px] font-bold text-yellow-400 uppercase tracking-widest">DEMO MODE</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-blue-600/20 text-blue-400 font-medium"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )
            }
          >
            <item.icon className="h-4 w-4 flex-shrink-0" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-border p-3">
        <button
          onClick={() => {
            localStorage.removeItem("token");
            window.location.href = "/login";
          }}
          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-red-400 transition-colors w-full"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span>Logout</span>
        </button>
      </div>
    </aside>
  );
}
