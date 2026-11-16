import { describe, expect, it } from "vitest";

import { effectiveRole, normalizeRole, previewableRoles, roleFlags, visibleNav } from "./role";

describe("normalizeRole", () => {
  it("keeps admin and turns anything else into user", () => {
    expect(normalizeRole("admin")).toBe("admin");
    expect(normalizeRole("user")).toBe("user");
    expect(normalizeRole("superuser")).toBe("user");
    expect(normalizeRole(undefined)).toBe("user");
  });
});

describe("roleFlags", () => {
  it("is a user while loading, so no admin UI flashes", () => {
    expect(roleFlags("admin", true)).toEqual({ role: "user", isAdmin: false });
  });

  it("is the fetched role once loaded", () => {
    expect(roleFlags("admin", false)).toEqual({ role: "admin", isAdmin: true });
    expect(roleFlags(null, false)).toEqual({ role: "user", isAdmin: false });
  });
});

describe("effectiveRole", () => {
  it("shows an admin as the role they preview", () => {
    expect(effectiveRole("admin", "user")).toBe("user");
    expect(effectiveRole("admin", "admin")).toBe("admin");
    expect(effectiveRole("admin", null)).toBe("admin");
  });

  it("ignores a preview for anyone who isn't an admin", () => {
    // A stale sessionStorage value must never lift a user to admin.
    expect(effectiveRole("user", "admin")).toBe("user");
    expect(effectiveRole("user", null)).toBe("user");
  });
});

describe("previewableRoles", () => {
  it("lets an admin pick any role, most capable first", () => {
    expect(previewableRoles("admin")).toEqual(["admin", "user"]);
  });

  it("gives everyone else nothing to pick", () => {
    expect(previewableRoles("user")).toEqual([]);
  });
});

describe("visibleNav", () => {
  const NAV = [
    { to: "/", adminOnly: false },
    { to: "/admin", adminOnly: true },
    { to: "/items" },
  ];

  it("hides admin-only entries from a user", () => {
    expect(visibleNav(NAV, false).map((i) => i.to)).toEqual(["/", "/items"]);
  });

  it("puts admin-only entries last for an admin, even when listed earlier", () => {
    expect(visibleNav(NAV, true).map((i) => i.to)).toEqual(["/", "/items", "/admin"]);
  });
});
