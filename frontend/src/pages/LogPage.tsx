import { useState } from "react";

import { useLogSession, useLogSessions, useLogStats, type LogEvent } from "../api/log";

/** Stat tile. Null means "no ratings yet", which is different from zero. */
function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-surface px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-lg font-semibold tabular-nums text-slate-900">{value}</p>
      {hint ? <p className="text-[11px] text-slate-400">{hint}</p> : null}
    </div>
  );
}

const TYPE_STYLE: Record<string, string> = {
  user: "text-blue-700",
  assistant: "text-slate-900",
  tool_call: "text-slate-500",
  tool_result: "text-slate-400",
  rating: "text-emerald-700",
  clock: "text-amber-700",
  refusal: "text-red-600",
  session_start: "text-slate-400",
  session_end: "text-slate-400",
};

function EventRow({ e }: { e: LogEvent }) {
  const p = e.payload;
  const text = typeof p.text === "string" ? p.text : "";
  const summary =
    e.type === "tool_call"
      ? `${p.name as string}(${JSON.stringify(p.input).slice(1, 90)})`
      : e.type === "tool_result"
        ? String(p.output ?? "").slice(0, 120).replace(/\n/g, " ⏎ ")
        : e.type === "rating"
          ? `turn ${p.turn}: ${p.score} ${p.feel}${p.note ? ` — ${p.note}` : ""}`
          : e.type === "clock"
            ? `${p.event} ${p.days}d → ${p.sim_today}`
            : text;
  return (
    <li className="border-b border-slate-100 py-1.5 last:border-0">
      <div className="flex gap-2">
        <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-slate-400">
          {e.seq}
        </span>
        <span
          className={`w-24 shrink-0 font-mono text-[11px] ${TYPE_STYLE[e.type] ?? "text-slate-500"}`}
        >
          {e.type}
          {p.hidden ? "*" : ""}
        </span>
        <span className="min-w-0 flex-1 whitespace-pre-wrap text-[13px] text-slate-700">
          {summary || <span className="text-slate-400">—</span>}
        </span>
      </div>
    </li>
  );
}

export default function LogPage() {
  const sessions = useLogSessions();
  const stats = useLogStats();
  const [open, setOpen] = useState<string | null>(null);
  const detail = useLogSession(open);
  const s = stats.data;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Log</h1>
        <p className="text-xs text-slate-500">
          Every turn, every tool call and every rating, kept in Postgres so it survives a
          restart or a redeploy. Read-only — a log you can tidy up afterwards is worth
          nothing.
        </p>
      </div>

      {stats.isError ? (
        <p className="text-sm text-red-600">
          Couldn&apos;t read the log: {(stats.error as Error).message}
        </p>
      ) : null}

      {s ? (
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="sessions" value={String(s.sessions)} />
          <Stat label="turns" value={String(s.turns)} hint={`${s.proactive_turns} unprompted`} />
          <Stat label="rated" value={`${s.rated}/${s.turns}`} />
          <Stat
            label="avg cleanup"
            value={s.avg_score === null ? "—" : s.avg_score.toFixed(2)}
            hint={s.pct_rated_zero === null ? "nothing rated" : `${s.pct_rated_zero}% used as-is`}
          />
          <Stat
            label="felt magic"
            value={String(s.feels.magic ?? 0)}
            hint={`${s.feels.annoying ?? 0} annoying · ${s.feels.meh ?? 0} meh`}
          />
          <Stat
            label="proposals"
            value={`${s.proposals.applied ?? 0}/${s.proposals.proposed ?? 0}`}
            hint={`${s.proposals.unresolved ?? 0} unresolved · ${s.proposals.rejected ?? 0} rejected`}
          />
        </section>
      ) : null}

      {s && s.cap_hits > 0 ? (
        <p className="text-xs text-amber-700">
          {s.cap_hits} turn(s) hit the 10-tool-call cap — a tool-design signal.
        </p>
      ) : null}

      {s && Object.keys(s.by_prompt_version).length > 1 ? (
        <section>
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            By prompt version
          </h2>
          <div className="flex flex-wrap gap-4 text-[13px] text-slate-700">
            {Object.entries(s.by_prompt_version).map(([v, d]) => (
              <span key={v}>
                <strong>{v}</strong>: {d.turns} turns, {d.rated} rated, avg{" "}
                {d.avg_score === null ? "—" : d.avg_score.toFixed(2)}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Sessions
        </h2>
        {sessions.isLoading ? <p className="text-sm text-slate-400">loading…</p> : null}
        {sessions.data?.length === 0 ? (
          <p className="text-sm text-slate-400">
            Nothing logged yet. Have a conversation and it will appear here.
          </p>
        ) : null}
        <ul className="space-y-1">
          {sessions.data?.map((x) => (
            <li key={x.id}>
              <button
                onClick={() => setOpen(open === x.id ? null : x.id)}
                className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-lg bg-surface px-3 py-2 text-left hover:bg-slate-100"
              >
                <span className="font-mono text-[12px] text-slate-500">{x.id}</span>
                <span className="text-[13px] font-medium text-slate-900">
                  {x.business ?? "(not set up)"}
                </span>
                <span className="text-[12px] text-slate-500">
                  {new Date(x.started_at).toLocaleString()}
                </span>
                <span className="text-[12px] text-slate-400">
                  {x.seed} · {x.prompt_version} · {x.turns} turns · {x.tool_calls} tools
                </span>
                <span className="ml-auto text-[12px] text-slate-500">
                  {x.rated ? `${x.rated} rated, avg ${x.avg_score?.toFixed(2)}` : "unrated"}
                </span>
              </button>

              {open === x.id ? (
                <div className="mt-1 rounded-lg bg-slate-50 p-3">
                  {detail.isLoading ? (
                    <p className="text-sm text-slate-400">loading transcript…</p>
                  ) : null}
                  <ul>{detail.data?.events.map((e) => <EventRow key={e.seq} e={e} />)}</ul>
                  <p className="mt-2 text-[11px] text-slate-400">
                    * a hidden turn is the check-in the agent gives itself on open — it
                    isn&apos;t something anyone typed.
                  </p>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
