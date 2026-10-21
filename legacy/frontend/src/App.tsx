import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MainLayout } from "./layouts/MainLayout";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import LivePage from "./pages/LivePage";
import MobileCameraPage from "./pages/MobileCameraPage";
import WorkersPage from "./pages/WorkersPage";
import WorkerProfilePage from "./pages/WorkerProfilePage";
import ViolationsPage from "./pages/ViolationsPage";
import ZonesPage from "./pages/ZonesPage";
import CamerasPage from "./pages/CamerasPage";
import EventsPage from "./pages/EventsPage";
import SettingsPage from "./pages/SettingsPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem("token");
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          {/* Mobile camera is standalone — no sidebar */}
          <Route
            path="/mobile-camera"
            element={
              <div className="min-h-screen bg-background p-4">
                <MobileCameraPage />
              </div>
            }
          />

          {/* Protected dashboard routes */}
          <Route
            element={
              <ProtectedRoute>
                <MainLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/live" element={<LivePage />} />
            <Route path="/workers" element={<WorkersPage />} />
            <Route path="/workers/:id" element={<WorkerProfilePage />} />
            <Route path="/violations" element={<ViolationsPage />} />
            <Route path="/zones" element={<ZonesPage />} />
            <Route path="/cameras" element={<CamerasPage />} />
            <Route path="/events" element={<EventsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>

          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
