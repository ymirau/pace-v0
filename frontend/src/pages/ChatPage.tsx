import { useCallback, useEffect, useRef, useState } from "react";

import { usePaceState, useResetPace, useTurn, type Reply, type ToolCall } from "../api/chat";
import RateBar from "../components/pace/RateBar";
import StatePanel from "../components/pace/StatePanel";

/**
 * What each tool means in words the founder would use.
 *
 * A turn is seconds of the model generating and nothing makes that shorter, so the wait
 * at least says what is happening: the agent announces each tool as it reaches for it.
 */
const DOING: Record<string, string> = {
  get_overview: "reading your work",
  find_tasks: "going through your tasks",
  check_timeline: "checking your dates",
  propose_plan: "drafting a plan",
  apply_proposal: "locking it in",
  reject_proposal: "noting that down",
  create_tasks: "writing that down",
  update_tasks: "updating your tasks",
  set_business: "saving your details",
  add_people: "adding your people",
};

interface Turn {
  who: "pace" | "you";
  text: string;
  tools?: ToolCall[];
  proactive?: boolean;
  /** Set on Pace turns, so the rating can be attached to the right turn. */
  sessionId?: string;
  turn?: number;
}

/** Grey one-liner showing what the agent looked at, like the terminal's → lines. */
function ToolTrace({ tools }: { tools: ToolCall[] }) {
  if (!tools.length) return null;
  return (
    <div className="mb-1 flex flex-wrap gap-1">
      {tools.map((t, i) => (
        <span
          key={i}
          className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500"
          title={JSON.stringify(t.input, null, 2)}
        >
          {t.name}
        </span>
      ))}
    </div>
  );
}

function Bubble({ turn }: { turn: Turn }) {
  const mine = turn.who === "you";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[42rem] ${mine ? "" : "w-full"}`}>
        {!mine && turn.tools ? <ToolTrace tools={turn.tools} /> : null}
        <div
          className={
            mine
              ? "rounded-2xl rounded-br-sm bg-slate-900 px-4 py-2.5 text-surface"
              : "rounded-2xl rounded-bl-sm bg-surface px-4 py-3 text-slate-800 ring-1 ring-slate-200"
          }
        >
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{turn.text}</p>
        </div>
        {!mine && turn.sessionId && turn.turn ? (
          <RateBar sessionId={turn.sessionId} turn={turn.turn} />
        ) : null}
      </div>
    </div>
  );
}

/** The turn in flight: what it has reached for, and whatever it has written so far. */
interface Live {
  tools: ToolCall[];
  text: string;
}

/**
 * The turn in flight. Shows the tools as chips the moment each one is called, a line
 * saying what it is doing in plain words, and the reply as it arrives.
 *
 * It reads as one bubble that fills in, rather than a spinner followed by a wall of
 * text — the turn itself is no shorter, but the founder can see it is working and on
 * what. No rating bar: a half-written reply isn't a turn to score yet.
 */
function LiveBubble({ live }: { live: Live }) {
  const last = live.tools[live.tools.length - 1];
  const doing = live.text
    ? null
    : last
      ? (DOING[last.name] ?? `running ${last.name}`)
      : "reading your work";
  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[42rem]">
        <ToolTrace tools={live.tools} />
        <div className="rounded-2xl rounded-bl-sm bg-surface px-4 py-3 ring-1 ring-slate-200">
          {live.text ? (
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-slate-800">
              {live.text}
            </p>
          ) : (
            <p className="animate-pulse text-[15px] text-slate-500">Pace is {doing}…</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ChatPage() {
  const state = usePaceState();
  const turnMutation = useTurn();
  const reset = useResetPace();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [live, setLive] = useState<Live | null>(null);
  const [draft, setDraft] = useState("");
  const opened = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);
  const busy = turnMutation.isPending;

  /** Run a turn, showing its tools and text as they arrive. `null` is the check-in. */
  const run = useCallback(
    (text: string | null) => {
      setLive({ tools: [], text: "" });
      turnMutation.mutate(
        {
          text,
          onTool: (t) => setLive((l) => ({ ...(l ?? { text: "" }), tools: [...(l?.tools ?? []), t] })),
          onText: (d) =>
            setLive((l) => ({ tools: l?.tools ?? [], text: (l?.text ?? "") + d })),
        },
        {
          onSuccess: (r: Reply) => {
            setLive(null);
            setTurns((t) => [
              ...t,
              {
                who: "pace",
                text: r.text,
                tools: r.tool_calls,
                proactive: r.proactive,
                sessionId: r.session_id,
                turn: r.turn,
              },
            ]);
          },
          onError: (err: Error) => {
            setLive(null);
            setTurns((t) => [...t, { who: "pace", text: `— couldn't reach the agent: ${err.message}` }]);
          },
        },
      );
    },
    [turnMutation],
  );

  // The agent speaks first. Once per mount, not on every re-render.
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    run(null);
  }, [run]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, busy]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    // You can always type. Sending waits for the turn in flight — a reply can take a
    // few seconds, and a disabled box made the app feel broken.
    if (!text || busy) return;
    setDraft("");
    setTurns((t) => [...t, { who: "you", text }]);
    run(text);
  }

  function onReset(seed: string) {
    const what =
      seed === "blank"
        ? "Start from an empty business? Pace will ask you what you're working on."
        : "Load the Tideline example (pre-launch B2B SaaS)? This clears the conversation and the state.";
    if (!confirm(what)) return;
    reset.mutate(seed, {
      onSuccess: () => {
        setTurns([]);
        run(null);
      },
    });
  }

  const s = state.data;

  return (
    <div className="flex h-full min-h-0 gap-4">
      <section className="flex min-h-0 flex-1 flex-col">
        <header className="mb-3 flex items-baseline justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Pace</h1>
            {s ? (
              <p className="text-xs text-slate-500">
                {[
                  s.founder.business || null,
                  s.founder.name || null,
                  s.founder.weekly_hours ? `${s.founder.weekly_hours}h/wk` : null,
                  s.today + (s.time_mode === "simulated" ? " (simulated)" : ""),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
          </div>
          {s ? (
            <div className="flex gap-1.5 text-xs">
              <button
                onClick={() => onReset("startup")}
                className="rounded border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-100"
              >
                load example
              </button>
              <button
                onClick={() => onReset("blank")}
                className="rounded border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-100"
              >
                start blank
              </button>
            </div>
          ) : null}
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-lg bg-slate-50 p-4">
          {turns.map((t, i) => (
            <Bubble key={i} turn={t} />
          ))}
          {live ? <LiveBubble live={live} /> : null}
          {reset.isError ? (
            <p className="text-sm text-red-600">
              Reset failed: {(reset.error as Error).message}
            </p>
          ) : null}
          <div ref={bottom} />
        </div>

        <form onSubmit={submit} className="mt-3 flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={busy ? "type while it thinks — Send when it's done…" : "say yes, or push back, or tell it what happened…"}
            className="flex-1 rounded-lg border border-slate-300 bg-surface px-3 py-2.5 text-[15px] text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-surface hover:bg-slate-700 disabled:opacity-40"
          >
            Send
          </button>
        </form>
      </section>

      {s ? <StatePanel state={s} /> : null}
    </div>
  );
}
