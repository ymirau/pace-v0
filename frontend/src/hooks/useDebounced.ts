import { useEffect, useState } from "react";

/**
 * Settle a rapidly-changing value, so a type-ahead is one query per pause
 * rather than one per keystroke (the people picker uses it against the
 * rate-limited Microsoft Graph).
 *
 * The value always goes through the timer, **even at `delayMs` 0**. Special-casing
 * 0 with a direct `setSettled(value)` in the effect body is a synchronous
 * cascading render, which `react-hooks/set-state-in-effect` refuses; a 0ms
 * timeout is an ordinary deferred update. That lets a test pass 0 and simply
 * await the query instead of driving fake timers.
 *
 * The cleanup is the debounce: each new `value` clears the pending timer, so
 * only a pause longer than `delayMs` ever reaches the returned value.
 */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}
