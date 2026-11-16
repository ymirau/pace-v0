import type { PaceState, Task } from "../../api/chat";

/** What the agent is looking at, so a claim in the chat can be checked against the state. */
function Row({ t }: { t: Task }) {
  const flags = [
    t.overdue && `${-(t.days_until ?? 0)}d late`,
    t.stale && `untouched ${t.days_since_touched}d`,
    t.waiting_on_name && `waiting on ${t.waiting_on_name}`,
  ].filter(Boolean) as string[];
  return (
    <li className="border-b border-slate-100 py-1.5 last:border-0">
      <div className="flex items-baseline gap-2">
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            t.status === "done"
              ? "bg-slate-300"
              : t.status === "blocked"
                ? "bg-red-600"
                : t.status === "doing"
                  ? "bg-blue-700"
                  : "bg-slate-400"
          }`}
        />
        <span
          className={`flex-1 text-[13px] ${
            t.status === "done"
              ? "text-slate-400 line-through"
              : "text-slate-700"
          }`}
        >
          {t.title}
        </span>
        <span className="shrink-0 text-[11px] text-slate-400">
          {t.assignee} · {t.estimate_hrs}h
        </span>
      </div>
      {flags.length ? (
        <p className="ml-3.5 text-[11px] text-amber-700">{flags.join(" · ")}</p>
      ) : null}
    </li>
  );
}

export default function StatePanel({ state }: { state: PaceState }) {
  const c = state.counts;
  const chips: [string, number, string][] = [
    ["overdue", c.overdue, "text-red-600"],
    ["stuck", c.stale, "text-amber-700"],
    ["blocked", c.blocked, "text-red-600"],
    ["on you", c.waiting_on_founder, "text-blue-700"],
  ];
  return (
    <aside className="hidden w-80 shrink-0 overflow-y-auto lg:block">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
        The work
      </h2>
      <p className="mb-3 text-[11px] text-slate-400">
        {state.founder.goal} — by {state.founder.goal_date}
      </p>

      <div className="mb-4 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        {chips.map(([label, n, cls]) => (
          <span key={label} className={n ? cls : "text-slate-400"}>
            <strong className="font-semibold">{n}</strong> {label}
          </span>
        ))}
      </div>

      {c.pending_proposals ? (
        <div className="mb-4 rounded-lg bg-blue-100 p-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">
            Waiting on your yes
          </p>
          {state.proposals
            .filter((p) => p.status === "pending")
            .map((p) => (
              <p key={p.id} className="mt-1 text-[13px] text-slate-700">
                {p.summary}
                <span className="block text-[11px] text-slate-500">{p.reason}</span>
              </p>
            ))}
        </div>
      ) : null}

      <div className="mb-4 space-y-1">
        {state.people.map((p) => {
          const weeks = p.capacity_hrs_week ? p.open_hrs / p.capacity_hrs_week : 0;
          return (
            <div key={p.id} className="flex items-baseline gap-2 text-[12px]">
              <span className="w-14 shrink-0 text-slate-600">{p.name}</span>
              <span className="flex-1 text-slate-400">
                {p.open_hrs}h / {p.capacity_hrs_week}h per wk
              </span>
              <span
                className={
                  weeks > 2 ? "text-amber-700" : "text-slate-400"
                }
              >
                {weeks.toFixed(1)}w
              </span>
            </div>
          );
        })}
      </div>

      {state.projects.map((pr) => (
        <section key={pr.id} className="mb-4">
          <div className="flex items-baseline justify-between">
            <h3 className="text-[13px] font-semibold text-slate-800">
              {pr.name}
              {pr.status !== "active" ? (
                <span className="ml-1 text-[11px] font-normal text-slate-400">({pr.status})</span>
              ) : null}
            </h3>
            <span className="text-[11px] text-slate-400">
              {pr.days_until === null ? "—" : `${pr.days_until}d`} · {pr.open_hrs}h
            </span>
          </div>
          <ul>
            {state.tasks
              .filter((t) => t.project_id === pr.id)
              .map((t) => (
                <Row key={t.id} t={t} />
              ))}
          </ul>
        </section>
      ))}
    </aside>
  );
}
