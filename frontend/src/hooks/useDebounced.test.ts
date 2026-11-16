// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDebounced } from "./useDebounced";

/**
 * The debounce, with fake timers — the one place in the suite that drives them.
 *
 * The people picker passes `debounceMs={0}` in its own tests and simply awaits the
 * query, which keeps those tests about the UI. But "typing does not fire a
 * request per keystroke" is a claim about the *timer*, and at 0ms there is no
 * timer behaviour left to observe. So it is asserted here, once, on the hook
 * every type-ahead in the app shares.
 */

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useDebounced", () => {
  it("does not report a new value until the delay has elapsed", () => {
    const { result, rerender } = renderHook(({ value }) => useDebounced(value, 300), {
      initialProps: { value: "" },
    });

    rerender({ value: "k" });
    act(() => void vi.advanceTimersByTime(299));
    expect(result.current).toBe("");

    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toBe("k");
  });

  it("reports only the LAST value when typing never pauses", () => {
    // The whole point: four keystrokes 100ms apart at a 300ms delay must settle
    // once, on "kevi" — four requests to a throttled Graph tenant is the bug.
    const { result, rerender } = renderHook(({ value }) => useDebounced(value, 300), {
      initialProps: { value: "" },
    });

    for (const value of ["k", "ke", "kev", "kevi"]) {
      rerender({ value });
      act(() => void vi.advanceTimersByTime(100));
      expect(result.current).toBe("");
    }

    act(() => void vi.advanceTimersByTime(300));
    expect(result.current).toBe("kevi");
  });

  it("still goes through the timer at a 0ms delay", () => {
    // Not a curiosity — it is the reason the hook has no `if (delayMs === 0)`
    // shortcut. A direct setState in the effect body would be the cascading
    // render `react-hooks/set-state-in-effect` refuses; the tests that pass 0
    // rely on this being an ordinary deferred update.
    const { result, rerender } = renderHook(({ value }) => useDebounced(value, 0), {
      initialProps: { value: "" },
    });

    rerender({ value: "kev" });
    expect(result.current).toBe("");

    act(() => void vi.advanceTimersByTime(0));
    expect(result.current).toBe("kev");
  });
});
