// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import SettingsMenu from "./SettingsMenu";

// The theme row's persistence is theme.test.ts's job; keep localStorage out of it.
vi.mock("../theme", () => ({ getTheme: () => "light", toggleTheme: () => "dark" }));

afterEach(cleanup);

const openMenu = () => fireEvent.click(screen.getByRole("button", { name: "Settings" }));

describe("SettingsMenu", () => {
  it("is closed until the ⋮ button is clicked", () => {
    render(<SettingsMenu onSignOut={vi.fn()} />);
    expect(screen.queryByRole("menu")).toBeNull();
    openMenu();
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("shows the env label and the build stamp", () => {
    render(<SettingsMenu />);
    openMenu();
    // vitest.config.ts defines __BUILD_STAMP__ as "test-build"; jsdom serves at "/" → loc.
    expect(screen.getByText("loc · test-build")).toBeTruthy();
  });

  it("closes the menu and hands off on Sign out", () => {
    const onSignOut = vi.fn();
    render(<SettingsMenu onSignOut={onSignOut} />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("omits Sign out without a handler (auth bypass)", () => {
    render(<SettingsMenu />);
    openMenu();
    expect(screen.queryByRole("menuitem", { name: "Sign out" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: /mode$/ })).toBeTruthy();
  });

  it("closes on Escape", () => {
    render(<SettingsMenu />);
    openMenu();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("collapses the sidebar from the menu, then closes", () => {
    const onCollapse = vi.fn();
    render(<SettingsMenu onCollapse={onCollapse} />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Collapse sidebar" }));
    expect(onCollapse).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("has no Collapse item without a handler (the rail's menu)", () => {
    render(<SettingsMenu />);
    openMenu();
    expect(screen.queryByRole("menuitem", { name: "Collapse sidebar" })).toBeNull();
  });
});
