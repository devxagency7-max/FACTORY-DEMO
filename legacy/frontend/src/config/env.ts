export const env = {
  API_URL: import.meta.env.VITE_API_URL || "http://localhost:5000",
  SIGNALR_URL: import.meta.env.VITE_SIGNALR_URL || "http://localhost:5000/hubs/live-events",
  AI_URL: import.meta.env.VITE_AI_URL || "http://localhost:8000",
};
