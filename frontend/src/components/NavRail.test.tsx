// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import NavRail from "./NavRail";

// The menu's theme row reads localStorage; that's theme.test.ts's job.
vi.mock("../theme", () => ({ getTheme: () => "light", toggleTheme: () => "dark" }));

afterEach(cleanup);

const ITEMS = [
  { to: "/", label: "Home", icon: "home", end: true },
  { to: "/items", label: "Items", icon: "items", end: false },
];
const ICONS = { home: <svg />, items: <svg /> };

function renderRail(path = "/items", props: Partial<Parameters<typeof NavRail>[0]> = {}) {
  const onExpand = vi.fn();
  render(
    <MemoryRouter initialEntries={[path]}>
      <NavRail
        items={ITEMS}
        icons={ICONS}
        envBadge={<span>loc</span>}
        account={{ name: "Jane Doe", bypassed: false }}
        onSignOut={vi.fn()}
        onExpand={onExpand}
        {...props}
      />
    </MemoryRouter>,
  );
  return { onExpand };
}

describe("NavRail", () => {
  it("names every icon-only link, with a tooltip", () => {
    renderRail();
    for (const label of ["Home", "Items"]) {
      const link = screen.getByRole("link", { name: label });
      expect(link.getAttribute("title")).toBe(label);
    }
  });

  it("marks the current page's link active", () => {
    renderRail("/items");
    expect(screen.getByRole("link", { name: "Items" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBeNull();
  });

  it("shows the env badge", () => {
    renderRail();
    expect(screen.getByText("loc")).toBeTruthy();
  });

  it("expands back to the sidebar", () => {
    const { onExpand } = renderRail();
    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(onExpand).toHaveBeenCalledOnce();
  });

  it("opens the account menu from the avatar, headed by the user's name", () => {
    renderRail();
    fireEvent.click(screen.getByRole("button", { name: "Account and settings" }));
    expect(screen.getByRole("menu").textContent).toContain("Jane Doe");
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeTruthy();
  });

  it("shows the auth-bypass notice instead of a name in local dev", () => {
    renderRail("/", { account: { name: "Signed in", bypassed: true }, onSignOut: undefined });
    fireEvent.click(screen.getByRole("button", { name: "Account and settings" }));
    expect(screen.getByRole("menu").textContent).toContain("Local dev — auth bypassed");
    expect(screen.queryByRole("menuitem", { name: "Sign out" })).toBeNull();
  });
});
