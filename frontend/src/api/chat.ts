import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "./client";

/** Mirrors backend/app/schemas/chat.py. */
export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface Reply {
  text: string;
  turn: number;
  proactive: boolean;
  tool_calls: ToolCall[];
  cap_hit: boolean;
}

export interface Task {
  id: string;
  project_id: string;
  title: string;
  assignee_id: string | null;
  assignee: string;
  status: "todo" | "doing" | "blocked" | "done";
  priority: "low" | "med" | "high";
  due_date: string | null;
  days_until: number | null;
  estimate_hrs: number;
  waiting_on: string | null;
  waiting_on_name: string | null;
  notes: string;
  last_touched: string;
  days_since_touched: number;
  overdue: boolean;
  stale: boolean;
}

export interface Project {
  id: string;
  name: string;
  status: "active" | "on_hold" | "done";
  due_date: string | null;
  days_until: number | null;
  why_it_matters: string;
  open_hrs: number;
}

export interface Person {
  id: string;
  name: string;
  role: string;
  capacity_hrs_week: number;
  open_hrs: number;
}

export interface Proposal {
  id: string;
  summary: string;
  reason: string;
  status: "pending" | "approved" | "modified" | "rejected";
  created: string;
  changes: Record<string, unknown>[];
}

export interface PaceState {
  seed: string;
  time_mode: "simulated" | "real";
  today: string;
  founder: { name: string; business: string; goal: string; goal_date: string; weekly_hours: number };
  people: Person[];
  projects: Project[];
  tasks: Task[];
  proposals: Proposal[];
  counts: {
    open: number;
    overdue: number;
    stale: number;
    blocked: number;
    waiting_on_founder: number;
    pending_proposals: number;
  };
}

export function usePaceState() {
  return useQuery({ queryKey: ["pace", "state"], queryFn: () => apiFetch<PaceState>("/chat/state") });
}

/** The proactive check-in. Called once on load: the agent speaks first. */
export function useOpenSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<Reply>("/chat/open", { method: "POST" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["pace", "state"] }),
  });
}

export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (text: string) =>
      apiFetch<Reply>("/chat/message", {
        method: "POST",
        body: JSON.stringify({ text }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["pace", "state"] }),
  });
}

export function useResetPace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (seed: string) =>
      apiFetch<PaceState>("/chat/reset", {
        method: "POST",
        body: JSON.stringify({ seed }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["pace"] }),
  });
}
