import { describe, expect, it } from "vitest";

import { resolveTheme } from "./theme";

describe("resolveTheme", () => {
  it("lets a stored 'dark' choice win over an OS light preference", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("lets a stored 'light' choice win over an OS dark preference", () => {
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("falls back to the OS preference when no value is stored", () => {
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme(null, false)).toBe("light");
  });

  it("falls back to the OS preference for an unknown stored value", () => {
    expect(resolveTheme("garbage", true)).toBe("dark");
    expect(resolveTheme("garbage", false)).toBe("light");
  });
});
