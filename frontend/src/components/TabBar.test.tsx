// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import TabBar from "./TabBar";

afterEach(cleanup);

const TABS = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta", badge: <span>3</span> },
] as const;

describe("TabBar", () => {
  it("renders a labelled tablist with one tab per item", () => {
    render(<TabBar tabs={TABS} value="a" onSelect={vi.fn()} ariaLabel="Sections" />);
    expect(screen.getByRole("tablist", { name: "Sections" })).toBeTruthy();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });

  it("marks only the selected tab aria-selected", () => {
    render(<TabBar tabs={TABS} value="b" onSelect={vi.fn()} ariaLabel="Sections" />);
    expect(screen.getByRole("tab", { name: "Alpha" }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("tab", { name: "Beta 3" }).getAttribute("aria-selected")).toBe("true");
  });

  it("selects none when value is null", () => {
    render(<TabBar tabs={TABS} value={null} onSelect={vi.fn()} ariaLabel="Sections" />);
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab.getAttribute("aria-selected")).toBe("false");
    }
  });

  it("calls onSelect with the clicked tab's value", () => {
    const onSelect = vi.fn();
    render(<TabBar tabs={TABS} value="a" onSelect={onSelect} ariaLabel="Sections" />);
    fireEvent.click(screen.getByRole("tab", { name: "Beta 3" }));
    expect(onSelect).toHaveBeenCalledWith("b");
  });
});
