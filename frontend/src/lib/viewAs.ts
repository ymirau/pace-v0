import { useSyncExternalStore } from "react";

import { ROLES, type Role } from "./role";

/**
 * An admin's "View as" preview: the role to show the UI as, one per browser tab,
 * in sessionStorage, so it survives a reload in that tab and is gone in a new one.
 * Never sent to the server. A tiny store (not React state) so the badge, the
 * banner and every page read the same value.
 *
 * Storage can be blocked (private mode, site data off): every access is in a
 * try/catch, and blocked storage simply means "not previewing".
 */

const KEY = "view-as-role";
const listeners = new Set<() => void>();

function read(): Role | null {
  try {
    const stored = sessionStorage.getItem(KEY);
    return ROLES.find((role) => role === stored) ?? null;
  } catch {
    return null;
  }
}

let current = read();

/** Preview as `role`, or stop previewing with null. */
export function setViewAsRole(role: Role | null): void {
  current = role;
  try {
    if (role) sessionStorage.setItem(KEY, role);
    else sessionStorage.removeItem(KEY);
  } catch {
    // Blocked storage: still applies in this page, just isn't kept across a reload.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The role this tab is previewing as, or null. */
export function useViewAsRole(): Role | null {
  return useSyncExternalStore(subscribe, () => current);
}
