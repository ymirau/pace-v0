import LogView from "../components/log/LogView";

/**
 * The Log page inside the app: **this browser's own** turns, tool calls and ratings.
 *
 * Scoped, and that is what makes it safe to sit behind the reviewer access code everyone
 * with the link holds. Someone reviewing Pace can see what they themselves said and
 * rated — useful, and harmless — without being handed every other reviewer's transcript.
 * It reads `/api/my-log`, which takes the scope from the request's own visitor header, so
 * there is no parameter to tamper with and a session id that isn't yours answers 404.
 *
 * The unscoped view across every visitor is `/viewer` (`pages/ViewerPage.tsx`), behind a
 * separate code. Both render `LogView`.
 */
export default function LogPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Your log</h1>
        <p className="text-xs text-slate-500">
          What you said to Pace, what it did, and how you rated it.
        </p>
      </div>
      <LogView scope="mine" />
    </div>
  );
}
