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

/**
 * How often the viewer re-reads the log while you watch it.
 *
 * The viewer is a **different tab** from the app — often a different browser or device —
 * so nothing in the app can tell it a rating happened. Invalidating the cache after
 * `useRateTurn` only reaches the tab that did the rating; a second tab has no idea. That
 * is why the viewer looked frozen while the ratings were in fact landing correctly.
 *
 * Polling rather than streaming, deliberately: an SSE feed would mean the server holding
 * a connection open, Vercel caps a function at 60s, and the reconnection logic buys
 * nothing a person can perceive over a three-second poll on a page they are reading.
 */
const VISIBLE_MS = 3_000;

/**
 * Still polling when hidden, just slowly — so coming back to the tab shows something
 * current rather than something from an hour ago, without paying for a 3s poll all day.
 */
const HIDDEN_MS = 30_000;

/**
 * The poll interval, chosen per tick from whether the tab can actually be seen.
 *
 * **Visibility, not focus.** A viewer on a second monitor is `visible` but not focused,
 * and that is the exact case this exists for: watching ratings land while you type in
 * the other window. `refetchOnWindowFocus` does nothing there, and keying off focus
 * would drop to the slow rate precisely when you are looking at it.
 *
 * Exported for the test: it is the one piece of this with a decision in it, and it is
 * pure.
 */
export function pollInterval(): number {
  // Guarded so it stays callable from a node-environment test with no jsdom.
  if (typeof document === "undefined") return VISIBLE_MS;
  return document.visibilityState === "visible" ? VISIBLE_MS : HIDDEN_MS;
}

/**
 * The polling options every live log query shares.
 *
 * `refetchIntervalInBackground` is the load-bearing one. Without it TanStack pauses the
 * timer whenever the document is hidden, so a viewer sitting behind the app's tab would
 * stop updating and only catch up when clicked — the same symptom this fixes, reached by
 * a different route.
 */
function live(enabled: boolean) {
  return {
    refetchInterval: enabled ? pollInterval : (false as const),
    refetchIntervalInBackground: true,
  };
}

export function useLogSessions(enabled = true) {
  return useQuery({
    queryKey: ["log", "sessions"],
    queryFn: () => apiFetch<SessionSummary[]>("/log/sessions"),
    ...live(enabled),
  });
}

export function useLogSession(id: string | null, enabled = true) {
  return useQuery({
    queryKey: ["log", "session", id],
    queryFn: () => apiFetch<SessionDetail>(`/log/sessions/${id}`),
    enabled: !!id,
    // An expanded transcript has to grow too: a rating pressed now belongs to the
    // session being read, and a stale panel would contradict the list above it.
    ...live(enabled && !!id),
  });
}

export function useLogStats(enabled = true) {
  return useQuery({
    queryKey: ["log", "stats"],
    queryFn: () => apiFetch<Stats>("/log/stats"),
    ...live(enabled),
  });
}

/**
 * Is the viewer code accepted? Used by `ViewerGate` and nothing else.
 *
 * Its own query key, so the gate's one-shot probe never shares an observer with the
 * page's polling queries — a login prompt that re-asked the server every three seconds
 * would be a silly way to spend function invocations.
 */
export function useViewerProbe() {
  return useQuery({
    queryKey: ["log", "probe"],
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
