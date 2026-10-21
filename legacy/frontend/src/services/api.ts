import axios from "axios";
import { env } from "../config/env";
import type { DashboardOverview, Violation, Worker } from "../types";

const api = axios.create({
  baseURL: env.API_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const dashboardService = {
  getOverview: async (): Promise<DashboardOverview> => {
    const { data } = await api.get<DashboardOverview>("/api/dashboard/overview");
    return data;
  },
  getViolations: async (): Promise<Violation[]> => {
    const { data } = await api.get<Violation[]>("/api/dashboard/violations");
    return data;
  },
};

export const workerService = {
  getWorkers: async (): Promise<Worker[]> => {
    const { data } = await api.get<Worker[]>("/api/workers");
    return data;
  },
};

export default api;
