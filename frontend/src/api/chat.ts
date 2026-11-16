import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch, apiStream } from "./client";

/** Mirrors backend/app/schemas/chat.py. */
export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface Reply {
  text: string;
  session_id: string;
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

/** What a turn reports while it is still running. */
export interface TurnEvents {
  /** The agent reached for something — one event per tool call, as it happens. */
  onTool?: (tool: ToolCall) => void;
  /** A piece of the reply. Short replies arrive as one chunk; long ones trickle. */
  onText?: (delta: string) => void;
}

/**
 * One turn, read as it happens.
 *
 * `text` is the founder's message, or null for the proactive opening check-in. A turn
 * is seconds of the model generating — two API calls and about 7s for the opening — so
 * the UI shows what it is doing rather than a spinner. Resolves with the finished
 * {@link Reply}, which is what gets rated.
 */
async function streamTurn(text: string | null, events: TurnEvents): Promise<Reply> {
  const response = await apiStream("/chat/stream", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished: Reply | null = null;

  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    // SSE frames are separated by a blank line; a frame may straddle two chunks.
    let split = buffer.indexOf("\n\n");
    for (; split >= 0; split = buffer.indexOf("\n\n")) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      let name = "message";
      let data = "";
      for (const line of frame.split("\n")) {
        if (line.startsWith("event: ")) name = line.slice(7);
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      if (!data) continue;
      const parsed = JSON.parse(data);
      if (name === "text") events.onText?.(parsed.delta as string);
      else if (name === "tool") events.onTool?.(parsed as ToolCall);
      else if (name === "done") finished = parsed as Reply;
      else if (name === "error") throw new Error(parsed.message as string);
    }
    if (done) break;
  }
  if (!finished) {
    throw new Error("The agent's reply ended before it finished.");
  }
  return finished;
}

/**
 * A turn: the opening check-in when `text` is null, the founder's message otherwise.
 *
 * One hook for both, because they are the same call on the backend — which is also why
 * reopening the app is instant: a conversation already under way replays its last reply
 * instead of paying for another one.
 */
export function useTurn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ text, ...events }: { text: string | null } & TurnEvents) =>
      streamTurn(text, events),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["pace", "state"] }),
  });
}

/**
 * Rate a turn. `feel` alone is a complete rating — one press, logged.
 *
 * `score` is cleanup cost (0 used as-is … 3 redid it myself) and may be null: you only
 * know it once you have used the reply. Sending it later replaces the same row.
 */
export function useRateTurn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (r: {
      session_id: string;
      turn: number;
      feel: string;
      score?: number | null;
      note?: string;
    }) => apiFetch<void>("/chat/rate", { method: "POST", body: JSON.stringify({ note: "", ...r }) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["log"] }),
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
