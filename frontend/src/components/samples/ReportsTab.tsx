import { ApiError } from "../../api/client";
import { useServerInfo } from "../../api/reports";

/** FastAPI errors arrive as `{"detail": "..."}`; fall back to the raw text. */
function errorDetail(error: unknown): string {
  if (!(error instanceof ApiError)) return (error as Error).message;
  try {
    const parsed = JSON.parse(error.detail) as { detail?: unknown };
    if (typeof parsed.detail === "string") return parsed.detail;
  } catch {
    // not JSON — use it as is
  }
  return error.detail || error.message;
}

export default function ReportsTab() {
  const { data, isLoading, isError, error } = useServerInfo();
  const unavailable = isError && error instanceof ApiError && error.status === 503;

  return (
    <div>
      <p className="mb-6 text-sm text-slate-600">
        Checks the connection to SQL Server, an existing database this app reads and writes.
      </p>

      {isLoading && <p className="text-sm text-slate-500">Connecting to SQL Server…</p>}

      {unavailable && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p>SQL Server isn’t available: {errorDetail(error)}</p>
          <p className="mt-1">
            Set <code>SQLSERVER_HOST</code>, <code>SQLSERVER_DATABASE</code>,{" "}
            <code>SQLSERVER_USER</code> and <code>SQLSERVER_PASSWORD</code> in the backend{" "}
            <code>.env</code>, and make sure Microsoft’s ODBC Driver 18 is installed.
          </p>
        </div>
      )}
      {isError && !unavailable && (
        <p className="text-sm text-red-600">Couldn’t reach SQL Server: {errorDetail(error)}</p>
      )}

      {data && (
        <dl className="grid gap-4 rounded-lg border border-slate-200 bg-surface p-4 text-sm sm:grid-cols-[max-content_1fr]">
          <dt className="font-medium text-slate-500">Database</dt>
          <dd className="font-medium text-slate-900">{data.database_name}</dd>
          <dt className="font-medium text-slate-500">Server time</dt>
          <dd className="tabular-nums text-slate-900">
            {new Date(data.server_time).toLocaleString()}
          </dd>
          <dt className="font-medium text-slate-500">Version</dt>
          <dd className="whitespace-pre-wrap font-mono text-xs text-slate-700">{data.version}</dd>
        </dl>
      )}
    </div>
  );
}
