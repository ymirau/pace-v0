import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "./client";

/** Mirrors backend/app/schemas/log.py. */
export interface SessionSummary {
  id: string;
  started_at: string;
  updated_at: string;
  model: string;
  prompt_version: string;
  seed: string;
  sim_today: string | null;
  business: string | null;
  turns: number;
  tool_calls: number;
  rated: number;
  avg_score: number | null;
}

export interface LogEvent {
  seq: number;
  type: string;
  created_at: string;
  payload: Record<string, unknown>;
}

export interface Rating {
  score: number;
  feel: string;
  note: string;
}

export interface SessionDetail {
  session: SessionSummary;
  events: LogEvent[];
  ratings: Record<number, Rating>;
}

export interface Stats {
  sessions: number;
  turns: number;
  proactive_turns: number;
  tool_calls: number;
  cap_hits: number;
  rated: number;
  avg_score: number | null;
  pct_rated_zero: number | null;
  feels: Record<string, number>;
  proposals: Record<string, number>;
  by_prompt_version: Record<string, { turns: number; rated: number; avg_score: number | null }>;
}

export function useLogSessions() {
  return useQuery({
    queryKey: ["log", "sessions"],
    queryFn: () => apiFetch<SessionSummary[]>("/log/sessions"),
  });
}

export function useLogSession(id: string | null) {
  return useQuery({
    queryKey: ["log", "session", id],
    queryFn: () => apiFetch<SessionDetail>(`/log/sessions/${id}`),
    enabled: !!id,
  });
}

export function useLogStats() {
  return useQuery({ queryKey: ["log", "stats"], queryFn: () => apiFetch<Stats>("/log/stats") });
}
