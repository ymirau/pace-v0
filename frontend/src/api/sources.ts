import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "./client";

// Mirrors the backend schemas/sources.py: one entry per optional source the
// backend still has, judged from its settings (it never connects to check).
export interface SourceStatus {
  key: string;
  configured: boolean;
}

/** Which optional data sources have their settings filled in (for the Home page). */
export function useSourceStatus() {
  return useQuery({
    queryKey: ["sources", "status"],
    queryFn: () => apiFetch<SourceStatus[]>("/sources/status"),
  });
}
