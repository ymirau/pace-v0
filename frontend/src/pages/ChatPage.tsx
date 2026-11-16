import { useEffect, useRef, useState } from "react";

import {
  usePaceState,
  useOpenSession,
  useResetPace,
  useSendMessage,
  type Reply,
  type ToolCall,
} from "../api/chat";
import StatePanel from "../components/pace/StatePanel";

interface Turn {
  who: "pace" | "you";
  text: string;
  tools?: ToolCall[];
  proactive?: boolean;
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
      </div>
    </div>
  );
}

export default function ChatPage() {
  const state = usePaceState();
  const open = useOpenSession();
  const send = useSendMessage();
  const reset = useResetPace();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const opened = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);

  // The agent speaks first. Once per mount, not on every re-render.
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    open.mutate(undefined, {
      onSuccess: (r: Reply) =>
        setTurns([{ who: "pace", text: r.text, tools: r.tool_calls, proactive: true }]),
    });
  }, [open]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, send.isPending]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || send.isPending) return;
    setDraft("");
    setTurns((t) => [...t, { who: "you", text }]);
    send.mutate(text, {
      onSuccess: (r: Reply) =>
        setTurns((t) => [...t, { who: "pace", text: r.text, tools: r.tool_calls }]),
      onError: (err: Error) =>
        setTurns((t) => [...t, { who: "pace", text: `— couldn't reach the agent: ${err.message}` }]),
    });
  }

  function onReset(seed: string) {
    if (!confirm(`Reload the "${seed}" seed? This clears the conversation and the state.`)) return;
    reset.mutate(seed, {
      onSuccess: () => {
        setTurns([]);
        opened.current = false;
        open.mutate(undefined, {
          onSuccess: (r: Reply) =>
            setTurns([{ who: "pace", text: r.text, tools: r.tool_calls, proactive: true }]),
        });
      },
    });
  }

  const s = state.data;
  const pending = open.isPending || send.isPending;

  return (
    <div className="flex h-full min-h-0 gap-4">
      <section className="flex min-h-0 flex-1 flex-col">
        <header className="mb-3 flex items-baseline justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">
              {s ? s.founder.business : "Pace"}
            </h1>
            {s ? (
              <p className="text-xs text-slate-500">
                {s.founder.name} · {s.founder.weekly_hours}h/wk · {s.today}
                {s.time_mode === "simulated" ? " (simulated)" : ""}
              </p>
            ) : null}
          </div>
          {s ? (
            <div className="flex gap-1.5 text-xs">
              <button
                onClick={() => onReset("example")}
                className="rounded border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-100"
              >
                reset example
              </button>
              <button
                onClick={() => onReset("mine")}
                className="rounded border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-100"
              >
                use mine
              </button>
            </div>
          ) : null}
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-lg bg-slate-50 p-4">
          {turns.map((t, i) => (
            <Bubble key={i} turn={t} />
          ))}
          {pending ? (
            <p className="animate-pulse text-sm text-slate-400">thinking…</p>
          ) : null}
          {open.isError ? (
            <p className="text-sm text-red-600">
              {(open.error as Error).message}
            </p>
          ) : null}
          <div ref={bottom} />
        </div>

        <form onSubmit={submit} className="mt-3 flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="say yes, or push back, or tell it what happened…"
            disabled={pending}
            className="flex-1 rounded-lg border border-slate-300 bg-surface px-3 py-2.5 text-[15px] text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={pending || !draft.trim()}
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
