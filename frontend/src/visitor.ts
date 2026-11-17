/**
 * Which browser this is — deliberately not who.
 *
 * The deployed app has no authentication, but each visitor still needs their own copy of
 * the business state. Before this existed everyone on the review link shared one world:
 * the first reviewer to clear an overdue task decided what the second reviewer was
 * shown, so the two of them rated different apps and the log didn't record it.
 *
 * So the browser mints a random id once and keeps it. Every API call sends it as
 * `X-Pace-Visitor` and the backend keys the state document and the conversation off it
 * (`backend/app/core/visitor.py`).
 *
 * **This is not a credential.** It's client-supplied, readable and editable by anyone
 * who opens devtools, and it gates nothing that matters — it partitions a demo world.
 * The charset is kept to plain hex because the server validates strictly: it ends up as
 * a database key.
 *
 * Storage caveats, both deliberate:
 *
 * - **localStorage, so it survives a reload** — a reviewer who refreshes must come back
 *   to their own conversation, not a stranger's and not a blank one.
 * - **If storage is unavailable** (private mode, a locked-down browser) a fresh id is
 *   minted per page load. That reviewer gets a new world on every reload, which is
 *   worse than remembering but much better than silently falling through to the shared
 *   `solo` world — the server reserves that name precisely so this can't happen.
 */
const KEY = "pace.visitor";

/** 16 hex characters: plenty against collision, short enough to read in the viewer. */
function mint(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

let cached: string | null = null;

export function getVisitorId(): string {
  if (cached) return cached;
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) {
      cached = stored;
      return stored;
    }
    const fresh = mint();
    localStorage.setItem(KEY, fresh);
    cached = fresh;
    return fresh;
  } catch {
    // No storage. Mint one for this page load and hold it in memory, so at least the
    // calls within a single visit agree with each other.
    cached ??= mint();
    return cached;
  }
}
