import { useState } from "react";
import { Link } from "react-router-dom";

import { useSourceStatus } from "../api/sources";
import PageHeading from "../components/PageHeading";

interface OptionalSource {
  key: string;
  name: string;
  /** What the source powers in this app, and where. */
  powers: string;
  page: string;
  to: string;
  /** The settings to fill in (backend .env locally, deploy env + host secrets when deployed). */
  envVars: string[];
  /** Whether it was kept when the app was scaffolded (/syn-init-webapp's data-source question). */
  included: boolean;
}

// Every optional data source the template offers, one line each. /syn-init-webapp's
// remove-sources.sh flips `included` to false for the ones an app didn't pick.
const OPTIONAL_SOURCES: OptionalSource[] = [
  { key: "clickhouse", name: "ClickHouse", powers: "Read-only analytics: the NYC taxi trips dashboard.", page: "Dashboard", to: "/samples/dashboard", envVars: ["CLICKHOUSE_HOST", "CLICKHOUSE_USER", "CLICKHOUSE_PASSWORD"], included: false },
  { key: "minio", name: "MinIO / S3", powers: "Object storage: upload, list and preview files.", page: "Files", to: "/samples/files", envVars: ["MINIO_ENDPOINT", "MINIO_ACCESS_KEY", "MINIO_SECRET_KEY"], included: false },
  { key: "sqlserver", name: "SQL Server", powers: "Read/write access to an existing SQL Server database.", page: "Reports", to: "/samples/reports", envVars: ["SQLSERVER_HOST", "SQLSERVER_DATABASE", "SQLSERVER_USER", "SQLSERVER_PASSWORD"], included: true },
];

type Status = "not-included" | "unknown" | "not-set-up" | "set-up";

const BADGE: Record<Status, { label: string; className: string }> = {
  "not-included": { label: "Not included", className: "bg-slate-100 text-slate-500" },
  unknown: { label: "Status unknown", className: "bg-slate-100 text-slate-600" },
  "not-set-up": { label: "Not set up", className: "bg-amber-100 text-amber-700" },
  "set-up": { label: "Set up", className: "bg-emerald-100 text-emerald-700" },
};

export default function HomePage() {
  const { data } = useSourceStatus();
  // Which source cards are open (all of them to start). The <details> elements
  // report their own toggles back here, so the heading's Expand all / Collapse all
  // stays in step.
  const [openKeys, setOpenKeys] = useState<ReadonlySet<string>>(
    () => new Set(OPTIONAL_SOURCES.map((s) => s.key)),
  );
  const allOpen = openKeys.size === OPTIONAL_SOURCES.length;
  const setCardOpen = (key: string, isOpen: boolean) =>
    setOpenKeys((prev) => {
      if (prev.has(key) === isOpen) return prev;
      const next = new Set(prev);
      if (isOpen) next.add(key);
      else next.delete(key);
      return next;
    });

  const statusOf = (source: OptionalSource): Status => {
    if (!source.included) return "not-included";
    const reported = data?.find((s) => s.key === source.key);
    if (!reported) return "unknown"; // still loading, or the status call failed
    return reported.configured ? "set-up" : "not-set-up";
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeading title="Home" className="mb-2" />
      <p className="mb-8 max-w-3xl text-sm text-slate-600">
        This app is built on the Synveon full-stack template: a FastAPI backend and a React
        front end, signed in with your Microsoft account. The{" "}
        <Link to="/samples/items" className="font-medium text-slate-900 underline">
          Samples
        </Link>{" "}
        page holds the worked examples, one tab per data source; Items is the one backed by
        the app’s own Postgres tables.
      </p>

      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Optional data sources
        </h2>
        <button
          type="button"
          onClick={() =>
            setOpenKeys(allOpen ? new Set() : new Set(OPTIONAL_SOURCES.map((s) => s.key)))
          }
          className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline"
        >
          {/* Double chevron: pointing in to collapse, out to expand. */}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="h-3.5 w-3.5"
            aria-hidden="true"
          >
            {allOpen ? (
              <path d="M7 20l5-5 5 5M7 4l5 5 5-5" />
            ) : (
              <path d="M7 15l5 5 5-5M7 9l5-5 5 5" />
            )}
          </svg>
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
      </div>
      {/* One full-width card per source, collapsed to its name + status; <details>
          gives the open/close, keyboard and screen-reader behaviour for free. */}
      <ul className="flex flex-col gap-3">
        {OPTIONAL_SOURCES.map((source) => {
          const status = statusOf(source);
          const badge = BADGE[status];
          return (
            <li
              key={source.key}
              className={`rounded-lg border border-slate-200 bg-surface text-sm ${
                status === "not-included" ? "opacity-60" : ""
              }`}
            >
              <details
                className="group"
                open={openKeys.has(source.key)}
                onToggle={(e) => setCardOpen(source.key, e.currentTarget.open)}
              >
                <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    className="h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform group-open:rotate-90"
                    aria-hidden="true"
                  >
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                  <span className="font-semibold text-slate-900">{source.name}</span>
                  <span
                    className={`ml-auto rounded px-1.5 py-0.5 text-[11px] font-medium ${badge.className}`}
                  >
                    {badge.label}
                  </span>
                </summary>
                <div className="px-4 pb-4 pl-[2.375rem]">
                  <p className="text-slate-600">{source.powers}</p>
                  {status === "not-included" ? (
                    <p className="mt-2 text-xs text-slate-500">Not included in this app.</p>
                  ) : (
                    <Link
                      to={source.to}
                      className="mt-2 inline-block text-xs font-medium text-slate-900 underline"
                    >
                      Open the {source.page} sample
                    </Link>
                  )}
                  {status === "not-set-up" && (
                    <p className="mt-2 text-xs text-slate-500">
                      Set{" "}
                      {source.envVars.map((v, i) => (
                        <span key={v}>
                          {i > 0 && ", "}
                          <code>{v}</code>
                        </span>
                      ))}{" "}
                      in the backend <code>.env</code>.
                    </p>
                  )}
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
