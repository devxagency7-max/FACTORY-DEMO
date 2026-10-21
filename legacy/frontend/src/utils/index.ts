import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour12: false });
}

export function severityLabel(s: number): string {
  return ["Low", "Medium", "High", "Critical"][s] ?? "Unknown";
}

export function severityColor(s: number): string {
  return [
    "text-blue-400",
    "text-yellow-400",
    "text-orange-400",
    "text-red-400",
  ][s] ?? "text-gray-400";
}

export function violationStatusLabel(s: number): string {
  return ["Pending", "Confirmed", "Dismissed", "Resolved"][s] ?? "Unknown";
}

export function violationStatusColor(s: number): string {
  return [
    "bg-yellow-500/20 text-yellow-400",
    "bg-red-500/20 text-red-400",
    "bg-gray-500/20 text-gray-400",
    "bg-green-500/20 text-green-400",
  ][s] ?? "bg-gray-500/20 text-gray-400";
}
