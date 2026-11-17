// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { pollInterval } from "./log";

/**
 * The viewer polls, and the poll rate is chosen from tab VISIBILITY rather than focus.
 *
 * That distinction is the whole bug fix and it is invisible in the diff, so it is pinned
 * here. The viewer's job is to be watched while someone types in the app's window, which
 * means it is routinely visible and unfocused:
 *
 * - keying off focus (`refetchOnWindowFocus`, or `document.hasFocus()`) would drop to the
 *   slow rate exactly when someone is looking at a second monitor;
 * - not polling while hidden at all is what TanStack does by default, which made a
 *   viewer sitting behind the app's tab stop updating until clicked.
 */
function setVisibility(state: "visible" | "hidden") {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(state);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pollInterval", () => {
  it("reads often while the tab can be seen", () => {
    setVisibility("visible");
    expect(pollInterval()).toBe(3_000);
  });

  it("keeps reading while the tab is hidden, but slowly", () => {
    setVisibility("hidden");
    const hidden = pollInterval();
    // Not zero and not false: a hidden viewer that stopped entirely is the bug. Not the
    // fast rate either, or an abandoned tab bills all afternoon.
    expect(hidden).toBeGreaterThan(3_000);
    expect(hidden).toBe(30_000);
  });

  it("does not depend on focus", () => {
    // A viewer on a second monitor: visible, not focused. It must stay on the fast rate.
    setVisibility("visible");
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    expect(pollInterval()).toBe(3_000);
  });
});
