# Factory AI Monitoring Platform - Dashboard & Mobile Camera Frontend

This is the real-time command center frontend for the **Factory AI Monitoring Platform**. It provides factory managers with live camera stream monitoring, real-time AI violation alerts via SignalR, worker & zone tracking, and a standalone Mobile Camera ingestion interface.

---

## 🛠️ Tech Stack

- **Framework**: React 19 + TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS (Dark Industrial Theme)
- **Icons**: Lucide React
- **Data Fetching & Caching**: TanStack React Query v5
- **Global State**: Zustand
- **Real-time WebSockets**: `@microsoft/signalr` & native WebSocket API
- **HTTP Client**: Axios

---

## 🚀 Quick Start

### 1. Prerequisites
- Node.js (v18+ recommended)
- Python AI Engine running on port `8000`
- ASP.NET Core Backend running on port `5000`

### 2. Setup Environment
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Default configuration:
```env
VITE_API_URL=http://localhost:5000
VITE_SIGNALR_URL=http://localhost:5000/hubs/live-events
VITE_AI_URL=http://localhost:8000
```

### 3. Install & Run
```bash
npm install
npm run dev
```

The application will be available at `http://localhost:5173`.

---

## 📱 Mobile Camera Streaming Setup

Modern mobile browsers strictly block camera access (`navigator.mediaDevices.getUserMedia`) over unencrypted `http://` connections unless the hostname is `localhost`.

To test using your smartphone camera:

### Option A: Cloudflare Tunnel (Recommended)
1. Install `cloudflared` on your machine.
2. Run a tunnel to expose your local Vite dev server:
   ```bash
   cloudflared tunnel --url http://localhost:5173
   ```
3. Run a tunnel for the AI Engine WebSocket:
   ```bash
   cloudflared tunnel --url http://localhost:8000
   ```
4. Open the generated HTTPS URL on your smartphone and navigate to **Mobile Camera** (`/mobile-camera`).

### Option B: Local IP Access (Local Testing)
If connecting over LAN (e.g. `http://192.168.1.X:5173`):
- iOS Safari allows local IP `getUserMedia` under specific flags or local certificates.
- Android Chrome allows flags: `chrome://flags/#unsafely-treat-insecure-origin-as-secure`.

---

## 💡 Key Features

1. **Live Camera Monitor (`/live`)**:
   - Displays real-time processed stream from Phase 1 AI Engine (`/ws/live`).
   - Draws bounding boxes (Workers, PPE status, Violations, Face Rec).
2. **Mobile Camera Streamer (`/mobile-camera`)**:
   - Captures smartphone camera feed.
   - Compresses and encodes JPEG frames to Base64.
   - Streams to `/ws/video-stream` on the AI Engine.
   - Renders live detection overlays on dynamic Canvas.
3. **Command Center Dashboard (`/dashboard`)**:
   - Real-time KPIs (Active Cameras, Today's Violations, Worker count).
   - Live SignalR alert feed.
   - Production efficiency placeholder (Phase 4).
4. **Violations Manager (`/violations`)**:
   - Lists detected safety violations.
   - Allows supervisors to Confirm or Dismiss alerts.

---

## 🏗️ Production Build

To build the static production assets:
```bash
npm run build
```

The output will be located in the `dist/` directory, ready to be served by Nginx or Docker.
