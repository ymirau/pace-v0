import LogView from "../components/log/LogView";
import PaceLogo from "../components/PaceLogo";

/**
 * The evidence viewer: every rating and every transcript, across every visitor.
 *
 * **Deliberately not a page of the app.** Its own URL (`/viewer`), outside the chat's
 * shell and nav, behind its own code (`ViewerGate`). Three reasons, in order of how much
 * they'd cost to get wrong:
 *
 * 1. The log spans every visitor, so anyone who could open it could read every other
 *    reviewer's conversation and the notes written about Pace's replies. Reviewers get
 *    the chat code; they don't get this one.
 * 2. A reviewer who wanders into the log is being shown the instrument instead of the
 *    thing being measured, which changes what they then rate.
 * 3. It's for watching ratings land while someone else uses the app — a second tab, not
 *    a tab inside the app.
 *
 * Reviewers get their *own* history in the app at `/log` (`pages/LogPage.tsx`), which is
 * this same screen scoped to one browser. All the shared rendering is in `LogView`.
 */
export default function ViewerPage() {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-slate-200 bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3">
          <PaceLogo className="text-slate-900" />
          <span className="text-[13px] text-slate-500">
            ratings log — everyone
          </span>
          <span className="ml-auto rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-600">
            not the app
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-5 py-5">
        <LogView scope="all" />
      </div>
    </div>
  );
}
