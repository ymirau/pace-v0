import { useMemo, useState } from "react";

import {
  useLogSession,
  useLogSessions,
  useLogStats,
  type Group,
  type LogEvent,
  type LogScope,
} from "../../api/log";

/**
 * The log, rendered once and shown in two places.
 *
 * * **`/viewer`** (`scope="all"`) — every visitor's transcripts and ratings, behind
 *   `PACE_VIEWER_CODE`, outside the app's shell and nav. The evidence v0 is for.
 * * **`/log`** (`scope="mine"`) — the same screen scoped to the caller's own sessions,
 *   inside the app behind the ordinary reviewer code, so somebody can see what they
 *   themselves said and rated.
 *
 * One component rather than two similar ones, because the second copy is where the
 * numbers start disagreeing about what "rated" means. The scope only picks which
 * endpoint to read and whether the per-visitor panel makes sense; the endpoint, not this
 * component, is what enforces who may see what.
 */

/** Stat tile. Null means "no ratings yet", which is different from zero. */
function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg bg-surface px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="text-lg font-semibold tabular-nums text-slate-900">
        {value}
      </p>
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
function Verdict({
  feels,
  rated,
  turns,
}: {
  feels: Record<string, number>;
  rated: number;
  turns: number;
}) {
  const rows = [
    {
      key: "magic",
      label: "Magic",
      bar: "bg-emerald-100",
      text: "text-emerald-700",
    },
    { key: "meh", label: "Meh", bar: "bg-slate-100", text: "text-slate-600" },
    {
      key: "annoying",
      label: "Annoying",
      bar: "bg-red-100",
      text: "text-red-600",
    },
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
          Nothing rated yet. Press Magic, Meh or Annoying under any reply in the
          chat — one press is the whole rating.
        </p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => {
            const n = feels[r.key] ?? 0;
            const pct = Math.round((100 * n) / rated);
            return (
              <div key={r.key} className="flex items-center gap-3">
                <span
                  className={`w-20 shrink-0 text-[13px] font-medium ${r.text}`}
                >
                  {r.label}
                </span>
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
function Ratings({
  ratings,
}: {
  ratings: Record<number, { feel: string; score: number | null; note: string }>;
}) {
  const turns = Object.keys(ratings)
    .map(Number)
    .sort((a, b) => a - b);
  if (!turns.length) {
    return (
      <p className="mb-2 text-[12px] text-slate-400">
        No ratings in this session.
      </p>
    );
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
          <li
            key={t}
            className="flex flex-wrap items-baseline gap-2 text-[12px]"
          >
            <span className="w-14 shrink-0 tabular-nums text-slate-400">
              turn {t}
            </span>
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

/** One breakdown row — shared by the per-version and per-visitor panels. */
function GroupRow({ label, d }: { label: string; d: Group }) {
  return (
    <span>
      <strong className="font-mono">{label}</strong>: {d.turns} turns, {d.rated}{" "}
      rated — <span className="text-emerald-700">{d.magic} magic</span>,{" "}
      <span className="text-red-600">{d.annoying} annoying</span>, avg cleanup{" "}
      {d.avg_score === null ? "—" : d.avg_score.toFixed(2)}
    </span>
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
        ? String(p.output ?? "")
            .slice(0, 120)
            .replace(/\n/g, " ⏎ ")
        : e.type === "rating"
          ? `turn ${p.turn}: ${p.feel}${
              p.score === null || p.score === undefined
                ? ""
                : `, cleanup ${p.score}`
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

/**
 * Whether the page is re-reading the log, and when it last did.
 *
 * Worth the pixels: the failure this replaces was a page that looked correct and was
 * silently stale, and "0 magic" is indistinguishable from "not updating" unless the page
 * says which it is. The ticking clock is the proof.
 *
 * Pause exists because the list reorders as sessions are touched, which fights you while
 * you are reading a long transcript.
 */
function LiveBadge({
  live,
  onToggle,
  updatedAt,
  fetching,
}: {
  live: boolean;
  onToggle: () => void;
  updatedAt: number;
  fetching: boolean;
}) {
  return (
    <div className="ml-auto flex items-center gap-2 text-[11px]">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={live}
        className={`flex items-center gap-1.5 rounded border px-1.5 py-0.5 font-medium ${
          live
            ? "border-emerald-700 text-emerald-700"
            : "border-slate-300 text-slate-500 hover:border-slate-900"
        }`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            live
              ? fetching
                ? "bg-emerald-700"
                : "bg-emerald-400"
              : "bg-slate-400"
          }`}
          role="presentation"
        />
        {live ? "live" : "paused"}
      </button>
      <span className="text-slate-400">
        {updatedAt ? `read ${new Date(updatedAt).toLocaleTimeString()}` : "…"}
      </span>
    </div>
  );
}

export default function LogView({ scope }: { scope: LogScope }) {
  // Live by default: these pages exist to be watched while a conversation happens.
  const [live, setLive] = useState(true);
  const sessions = useLogSessions(scope, live);
  const stats = useLogStats(scope, live);
  const [open, setOpen] = useState<string | null>(null);
  const [visitor, setVisitor] = useState<string | null>(null);
  const detail = useLogSession(scope, open, live);
  const s = stats.data;

  // Only meaningful on the unscoped view. Scoped to one browser there is exactly one
  // visitor, so a breakdown and a filter would both be a row of one.
  const showVisitors = scope === "all";

  // Every visitor that has a session, newest first — the order the list is already in,
  // so the person currently using the app is the first chip.
  const visitors = useMemo(() => {
    const seen: string[] = [];
    for (const x of sessions.data ?? []) {
      if (!seen.includes(x.visitor)) seen.push(x.visitor);
    }
    return seen;
  }, [sessions.data]);

  const shown = (sessions.data ?? []).filter(
    (x) => visitor === null || x.visitor === visitor,
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-2xl text-xs text-slate-500">
          {showVisitors
            ? "Every turn, every tool call and every rating, from every browser that has used the link, kept in Postgres so it survives a restart or a redeploy."
            : "Every turn, every tool call and every rating from this browser, kept in Postgres so it survives a restart or a redeploy. Other people's conversations aren't here."}{" "}
          Read-only — a log you can tidy up afterwards is worth nothing. It
          re-reads every few seconds, so you can leave it open and watch ratings
          arrive.
        </p>
        <LiveBadge
          live={live}
          onToggle={() => setLive((v) => !v)}
          updatedAt={stats.dataUpdatedAt}
          fetching={stats.isFetching}
        />
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
          <Stat
            label="turns"
            value={String(s.turns)}
            hint={`${s.proactive_turns} unprompted`}
          />
          <Stat
            label="rated"
            value={`${s.rated}/${s.turns}`}
            hint="one press each"
          />
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
          <div className="flex flex-col gap-1 text-[13px] text-slate-700">
            {Object.entries(s.by_prompt_version).map(([v, d]) => (
              <GroupRow key={v} label={v} d={d} />
            ))}
          </div>
        </section>
      ) : null}

      {showVisitors && s && Object.keys(s.by_visitor).length > 0 ? (
        <section>
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            By visitor
          </h2>
          <p className="mb-1.5 text-[11px] text-slate-400">
            One row per browser, not per person — a visitor id says &ldquo;same
            browser as before&rdquo; and nothing more. Each has its own copy of
            the app, so one reviewer&apos;s cleanup never changed what another
            was shown.
          </p>
          <div className="flex flex-col gap-1 text-[13px] text-slate-700">
            {Object.entries(s.by_visitor)
              .sort((a, b) => b[1].turns - a[1].turns)
              .map(([v, d]) => (
                <GroupRow key={v} label={v} d={d} />
              ))}
          </div>
        </section>
      ) : null}

      <section>
        <div className="mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Sessions
          </h2>
          {showVisitors && visitors.length > 1 ? (
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={() => setVisitor(null)}
                aria-pressed={visitor === null}
                className={`rounded border px-1.5 py-0.5 text-[11px] ${
                  visitor === null
                    ? "border-slate-900 bg-slate-900 text-surface"
                    : "border-slate-300 text-slate-600 hover:border-slate-900"
                }`}
              >
                everyone
              </button>
              {visitors.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setVisitor(v)}
                  aria-pressed={visitor === v}
                  className={`rounded border px-1.5 py-0.5 font-mono text-[11px] ${
                    visitor === v
                      ? "border-slate-900 bg-slate-900 text-surface"
                      : "border-slate-300 text-slate-600 hover:border-slate-900"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {sessions.isLoading ? (
          <p className="text-sm text-slate-400">loading…</p>
        ) : null}
        {sessions.data && shown.length === 0 ? (
          <p className="text-sm text-slate-400">
            {sessions.data.length === 0
              ? showVisitors
                ? "Nothing logged yet. Have a conversation in the app and it will appear here."
                : "Nothing logged yet. Say something to Pace and it will appear here."
              : "No sessions from that visitor."}
          </p>
        ) : null}
        <ul className="space-y-1">
          {shown.map((x) => (
            <li key={x.id}>
              <button
                onClick={() => setOpen(open === x.id ? null : x.id)}
                className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-lg bg-surface px-3 py-2 text-left hover:bg-slate-100"
              >
                <span className="font-mono text-[12px] text-slate-500">
                  {x.id}
                </span>
                <span className="text-[13px] font-medium text-slate-900">
                  {x.business ?? "(not set up)"}
                </span>
                <span className="text-[12px] text-slate-500">
                  {new Date(x.started_at).toLocaleString()}
                </span>
                <span className="text-[12px] text-slate-400">
                  {showVisitors ? (
                    <>
                      <span className="font-mono">{x.visitor}</span> ·{" "}
                    </>
                  ) : null}
                  {x.seed} · {x.prompt_version} · {x.turns} turns ·{" "}
                  {x.tool_calls} tools
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
                    <p className="text-sm text-slate-400">
                      loading transcript…
                    </p>
                  ) : null}
                  {detail.data ? (
                    <Ratings ratings={detail.data.ratings} />
                  ) : null}
                  <ul>
                    {detail.data?.events.map((e) => (
                      <EventRow key={e.seq} e={e} />
                    ))}
                  </ul>
                  <p className="mt-2 text-[11px] text-slate-400">
                    * a hidden turn is the check-in the agent gives itself on
                    open — it isn&apos;t something anyone typed.
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
