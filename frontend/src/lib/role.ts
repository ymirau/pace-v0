/**
 * Pure role logic (no React), shared by `useRole()` (api/me.ts) and the nav.
 * Node-testable. Roles are admin / user.
 *
 * The backend is the source of truth: everything here only decides what to SHOW.
 * Every admin-only endpoint carries `require_role("admin")` itself.
 */

/** Mirrors `ROLES` in the backend's app/core/roles.py. */
export type Role = "admin" | "user";

/** Every role, most capable first: the order the "View as" menu lists them. */
export const ROLES: readonly Role[] = ["admin", "user"];

export const ROLE_LABEL: Record<Role, string> = { admin: "Admin", user: "User" };

/** The role pill's colours (RoleBadge). Keyed by Role, so a new role is a type
 *  error here rather than an unstyled pill. */
export const ROLE_PILL_CLASS: Record<Role, string> = {
  admin: "bg-blue-100 text-blue-700",
  user: "bg-slate-100 text-slate-500",
};

/** An arbitrary/unknown value as a known Role, defaulting to "user". */
export function normalizeRole(role: string | null | undefined): Role {
  return role === "admin" ? "admin" : "user";
}

/**
 * The role to gate UI by. While `/api/me` is loading, or when it failed, this is
 * "user", so no admin-only UI flashes before the real role arrives.
 */
export function roleFlags(
  role: string | null | undefined,
  isLoading: boolean,
): { role: Role; isAdmin: boolean } {
  const effective: Role = isLoading ? "user" : normalizeRole(role);
  return { role: effective, isAdmin: effective === "admin" };
}

/** The roles a real `realRole` may preview ("View as"): every role for an admin,
 *  none for anyone else. Includes the admin's own role, which ends the preview. */
export function previewableRoles(realRole: Role): readonly Role[] {
  return realRole === "admin" ? ROLES : [];
}

/**
 * The role the UI acts as: the previewed one while an admin uses "View as",
 * otherwise the real role. Only an admin can preview, so a user who somehow has a
 * preview stored is unchanged.
 */
export function effectiveRole(realRole: Role, viewAs: Role | null): Role {
  return viewAs && previewableRoles(realRole).includes(viewAs) ? viewAs : realRole;
}

/**
 * The nav entries to show: `adminOnly` ones only for an (effective) admin, and
 * always LAST, after every other entry, whatever their order in `items` — so a
 * page an app appends to NAV later still lands above Admin.
 */
export function visibleNav<T extends { adminOnly?: boolean }>(items: readonly T[], isAdmin: boolean): T[] {
  const everyone = items.filter((item) => !item.adminOnly);
  return isAdmin ? [...everyone, ...items.filter((item) => item.adminOnly)] : everyone;
}
