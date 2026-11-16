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

/**
 * The verdict, in full: how many replies felt magic, meh or annoying.
 *
 * This is the one number v0 is for, so it gets its own panel rather than a tile in a
 * row of six. Percentages are of *rated* turns, and the unrated count is shown beside
 * them — 4 magic out of 5 rated means something very different when 60 turns went
 * unrated, and a panel that hid that would be flattering rather than useful.
 */
function Verdict({ feels, rated, turns }: { feels: Record<string, number>; rated: number; turns: number }) {
  const rows = [
    { key: "magic", label: "Magic", bar: "bg-emerald-100", text: "text-emerald-700" },
    { key: "meh", label: "Meh", bar: "bg-slate-100", text: "text-slate-600" },
    { key: "annoying", label: "Annoying", bar: "bg-red-100", text: "text-red-600" },
  ] as const;
  return (
    <section className="rounded-lg bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Magic or annoying
        </h2>
        <p className="text-[12px] text-slate-500">
          {rated} of {turns} replies rated
          {turns > rated ? ` · ${turns - rated} not rated yet` : ""}
        </p>
      </div>
      {rated === 0 ? (
        <p className="text-sm text-slate-400">
          Nothing rated yet. Press Magic, Meh or Annoying under any reply in the chat — one
          press is the whole rating.
        </p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => {
            const n = feels[r.key] ?? 0;
            const pct = Math.round((100 * n) / rated);
            return (
              <div key={r.key} className="flex items-center gap-3">
                <span className={`w-20 shrink-0 text-[13px] font-medium ${r.text}`}>{r.label}</span>
                <div className="h-5 min-w-0 flex-1 rounded bg-canvas">
                  <div
                    className={`h-5 rounded ${r.bar}`}
                    style={{ width: `${pct}%` }}
                    role="presentation"
                  />
                </div>
                <span className="w-20 shrink-0 text-right text-[13px] tabular-nums text-slate-700">
                  {n} · {pct}%
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** The ratings of one session, listed plainly: what was pressed, and on which turn. */
function Ratings({ ratings }: { ratings: Record<number, { feel: string; score: number | null; note: string }> }) {
  const turns = Object.keys(ratings)
    .map(Number)
    .sort((a, b) => a - b);
  if (!turns.length) {
    return <p className="mb-2 text-[12px] text-slate-400">No ratings in this session.</p>;
  }
  const FEEL_STYLE: Record<string, string> = {
    magic: "bg-emerald-100 text-emerald-700",
    meh: "bg-slate-100 text-slate-600",
    annoying: "bg-red-100 text-red-600",
  };
  return (
    <ul className="mb-3 space-y-1">
      {turns.map((t) => {
        const r = ratings[t];
        return (
          <li key={t} className="flex flex-wrap items-baseline gap-2 text-[12px]">
            <span className="w-14 shrink-0 tabular-nums text-slate-400">turn {t}</span>
            <span
              className={`rounded px-1.5 py-0.5 font-medium ${FEEL_STYLE[r.feel] ?? "bg-slate-100 text-slate-600"}`}
            >
              {r.feel}
            </span>
            <span className="text-slate-500">
              {r.score === null ? "no cleanup score" : `cleanup ${r.score}`}
            </span>
            {r.note ? <span className="text-slate-700">— {r.note}</span> : null}
          </li>
        );
      })}
    </ul>
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
          ? `turn ${p.turn}: ${p.feel}${
              p.score === null || p.score === undefined ? "" : `, cleanup ${p.score}`
            }${p.note ? ` — ${p.note}` : ""}`
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

      {s ? <Verdict feels={s.feels} rated={s.rated} turns={s.turns} /> : null}

      {s ? (
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="sessions" value={String(s.sessions)} />
          <Stat label="turns" value={String(s.turns)} hint={`${s.proactive_turns} unprompted`} />
          <Stat label="rated" value={`${s.rated}/${s.turns}`} hint="one press each" />
          <Stat
            label="avg cleanup"
            value={s.avg_score === null ? "—" : s.avg_score.toFixed(2)}
            hint={
              s.scored === 0
                ? "no cleanup scores yet"
                : `over ${s.scored} · ${s.pct_rated_zero}% used as-is`
            }
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
                <strong>{v}</strong>: {d.turns} turns, {d.rated} rated — {d.magic} magic,{" "}
                {d.annoying} annoying, avg cleanup{" "}
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
                  {x.rated
                    ? `${x.magic} magic · ${x.annoying} annoying · ${x.rated} rated`
                    : "unrated"}
                </span>
              </button>

              {open === x.id ? (
                <div className="mt-1 rounded-lg bg-slate-50 p-3">
                  {detail.isLoading ? (
                    <p className="text-sm text-slate-400">loading transcript…</p>
                  ) : null}
                  {detail.data ? <Ratings ratings={detail.data.ratings} /> : null}
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
