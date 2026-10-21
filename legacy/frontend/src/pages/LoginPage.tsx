import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Activity } from "lucide-react";
import api from "../services/api";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Try to hit the actual Phase 2 auth endpoint
      const { data } = await api.post("/api/auth/login", { email, password });
      localStorage.setItem("token", data.token);
      navigate("/dashboard");
    } catch (err: any) {
      // For DEMO: if backend doesn't have /api/auth/login yet, allow demo bypass
      if (email === "admin@factory.ai" && password === "admin") {
        localStorage.setItem("token", "demo-token");
        navigate("/dashboard");
      } else {
        setError("Invalid credentials. Demo: admin@factory.ai / admin");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="h-14 w-14 rounded-lg bg-blue-600 flex items-center justify-center mb-4">
            <Activity className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-xl font-bold text-foreground">Factory AI Platform</h1>
          <p className="text-sm text-muted-foreground mt-1">Sign in to Command Center</p>
        </div>

        <form onSubmit={handleSubmit} className="rounded-lg border border-border bg-[hsl(var(--card))] p-6 space-y-4">
          {error && (
            <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="admin@factory.ai"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="••••••••"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>

          <p className="text-[10px] text-center text-muted-foreground">
            Demo: admin@factory.ai / admin
          </p>
        </form>
      </div>
    </div>
  );
}
