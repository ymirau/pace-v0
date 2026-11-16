import { useQuery } from "@tanstack/react-query";

import { effectiveRole, roleFlags, type Role } from "../lib/role";
import { setViewAsRole, useViewAsRole } from "../lib/viewAs";
import { apiFetch } from "./client";

/** Mirrors the backend's schemas/me.py. `role` is the REAL role. */
export interface Me {
  email: string | null;
  name: string;
  role: Role;
}

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/me") });
}

/**
 * The caller's role for gating UI. `role` / `isAdmin` are the EFFECTIVE values
 * (the previewed role while an admin uses "View as"); `realRole` / `isRealAdmin`
 * are what the server says, for the badge and the banner. `previewing` is the
 * role being previewed, or null. Loading or a failed /api/me means "user"
 * (lib/role.ts).
 */
export function useRole() {
  const me = useMe();
  const { role: realRole } = roleFlags(me.data?.role, me.isLoading || me.isError);
  const role = effectiveRole(realRole, useViewAsRole());
  return {
    realRole,
    isRealAdmin: realRole === "admin",
    role,
    isAdmin: role === "admin",
    previewing: role === realRole ? null : role,
    setViewAsRole,
  };
}
