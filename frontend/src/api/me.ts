import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "./client";

/** Mirrors the backend's schemas/me.py. Roles went with the admin module. */
export interface Me {
  email: string | null;
  name: string;
}

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/me") });
}
