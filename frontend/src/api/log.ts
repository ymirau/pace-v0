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
  /** Which browser produced it. Not a person — see src/visitor.ts. */
  visitor: string;
  sim_today: string | null;
  business: string | null;
  turns: number;
  tool_calls: number;
  /** Turns with a magic / meh / annoying verdict. One press is enough. */
  rated: number;
  magic: number;
  annoying: number;
  /** Over the ratings that also carry a cleanup score; null when none do. */
  avg_score: number | null;
}

export interface LogEvent {
  seq: number;
  type: string;
  created_at: string;
  payload: Record<string, unknown>;
}

export interface Rating {
  feel: string;
  /** Null when the turn was rated by feel alone, which is a complete rating. */
  score: number | null;
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
  /** Of those, how many also carry a cleanup score. `avg_score` is over these only. */
  scored: number;
  avg_score: number | null;
  pct_rated_zero: number | null;
  /** Always carries all three keys, so "0 annoying" renders as a number. */
  feels: Record<string, number>;
  proposals: Record<string, number>;
  by_prompt_version: Record<string, Group>;
  /** Per-browser totals, so one keen reviewer reads as one reviewer. */
  by_visitor: Record<string, Group>;
}

/** One row of a breakdown — by prompt version, or by visitor. */
export interface Group {
  turns: number;
  sessions: number;
  rated: number;
  magic: number;
  annoying: number;
  avg_score: number | null;
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
  return useQuery({
    queryKey: ["log", "stats"],
    queryFn: () => apiFetch<Stats>("/log/stats"),
  });
}

/**
 * Is the reviewer's access code accepted? Used by `AccessGate` and nothing else.
 *
 * It used to probe `/log/stats`, which answered a different question once the log moved
 * behind its own viewer code: a reviewer with a perfectly good access code would have
 * been shown the "wrong code" prompt forever. `/chat/ping` carries the chat router's
 * gate and costs no model call, no state read and no write.
 */
export function useAccessProbe() {
  return useQuery({
    queryKey: ["chat", "ping"],
    queryFn: () => apiFetch<{ ok: boolean }>("/chat/ping"),
  });
}
