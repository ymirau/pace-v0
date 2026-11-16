import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "./client";

// Mirrors the backend schemas/reports.py. `server_time` is an ISO datetime string.
export interface ServerInfo {
  version: string;
  database_name: string;
  server_time: string;
}

/** SQL Server connectivity check. 503 when SQL Server or its ODBC driver is missing. */
export function useServerInfo() {
  return useQuery({
    queryKey: ["reports", "server-info"],
    queryFn: () => apiFetch<ServerInfo>("/reports/server-info"),
    // SQL Server may be unconfigured (503) or unreachable (502) — don't hammer it.
    retry: false,
  });
}
