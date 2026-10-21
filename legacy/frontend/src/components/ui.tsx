import React from "react";
import { cn } from "../utils";

interface StatusIndicatorProps {
  label: string;
  online: boolean;
  className?: string;
}

export function StatusIndicator({ label, online, className }: StatusIndicatorProps) {
  return (
    <div className={cn("flex items-center gap-2 text-xs", className)}>
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          online ? "bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]" : "bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.6)]"
        )}
      />
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-medium", online ? "text-green-400" : "text-red-400")}>
        {online ? "ONLINE" : "OFFLINE"}
      </span>
    </div>
  );
}

interface KPICardProps {
  title: string;
  value: string | number;
  icon?: React.ReactNode;
  subtitle?: string;
  trend?: "up" | "down" | "neutral";
  className?: string;
}

export function KPICard({ title, value, icon, subtitle, className }: KPICardProps) {
  return (
    <div className={cn(
      "rounded-lg border border-border bg-[hsl(var(--card))] p-4",
      className
    )}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</span>
        {icon && <span className="text-muted-foreground">{icon}</span>}
      </div>
      <div className="text-2xl font-bold text-foreground">{value}</div>
      {subtitle && <div className="text-xs text-muted-foreground mt-1">{subtitle}</div>}
    </div>
  );
}

interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "success" | "warning" | "danger" | "info";
  className?: string;
}

export function Badge({ children, variant = "default", className }: BadgeProps) {
  const variants = {
    default: "bg-secondary text-secondary-foreground",
    success: "bg-green-500/20 text-green-400",
    warning: "bg-yellow-500/20 text-yellow-400",
    danger: "bg-red-500/20 text-red-400",
    info: "bg-blue-500/20 text-blue-400",
  };
  return (
    <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium", variants[variant], className)}>
      {children}
    </span>
  );
}
