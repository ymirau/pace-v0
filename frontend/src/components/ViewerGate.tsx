import { useState } from "react";

import { ApiError } from "../api/client";
import { useLogStats } from "../api/log";
import { setViewerCode } from "../viewerCode";

/**
 * The log viewer's own gate — a different code from the one reviewers get.
 *
 * Why separate: the log is universal across visitors. One code for both would mean every
 * reviewer holding the chat link could also read every other reviewer's transcript, and
 * the notes written about the agent's replies. The chat code is handed out; this one
 * isn't.
 *
 * Same shape as `AccessGate`: probe the endpoint, and treat a 401 as "the code is
 * missing or wrong". With `PACE_VIEWER_CODE` empty (local dev) the probe succeeds and
 * nobody sees a prompt.
 *
 * This is still not authentication — one shared secret, no identity. It keeps the log
 * off the open internet; it would not survive someone determined.
 */
export default function ViewerGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const probe = useLogStats();
  const [code, setCode] = useState("");

  const needsCode = probe.isError && (probe.error as ApiError)?.status === 401;

  if (!needsCode) return <>{children}</>;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setViewerCode(code);
          probe.refetch();
        }}
        className="w-full max-w-sm space-y-3 rounded-xl bg-surface p-6"
      >
        <h1 className="text-lg font-semibold text-slate-900">
          Pace — ratings log
        </h1>
        <p className="text-sm text-slate-600">
          This is the evidence viewer, not the app. It needs the viewer code,
          which is not the code reviewers are given.
        </p>
        <input
          autoFocus
          type="password"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="viewer code"
          className="w-full rounded-lg border border-slate-300 bg-surface px-3 py-2 text-slate-900"
        />
        <button
          type="submit"
          disabled={!code.trim()}
          className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-surface disabled:opacity-40"
        >
          Open the log
        </button>
      </form>
    </div>
  );
}
