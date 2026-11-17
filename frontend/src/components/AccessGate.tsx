import { useState } from "react";

import { useAccessProbe } from "../api/log";
import { ApiError } from "../api/client";
import { setAccessCode } from "../accessCode";

/**
 * The deployed app's shared-code gate.
 *
 * Probes `/api/chat/ping`, which exists for exactly this. Locally `PACE_ACCESS_CODE` is empty, the backend lets
 * everything through, and this renders its children immediately — nobody sees a prompt.
 * Deployed, a 401 means the code is missing or wrong, and the reviewer types it once.
 *
 * This is not authentication and shouldn't be mistaken for it: one secret, shared, with
 * no identity behind it. It is here so a review link can't run up the Anthropic bill.
 */
export default function AccessGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const probe = useAccessProbe();
  const [code, setCode] = useState("");

  const needsCode = probe.isError && (probe.error as ApiError)?.status === 401;

  if (needsCode) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setAccessCode(code);
            probe.refetch();
          }}
          className="w-full max-w-sm space-y-3 rounded-xl bg-surface p-6"
        >
          <h1 className="text-lg font-semibold text-slate-900">Pace</h1>
          <p className="text-sm text-slate-600">
            This is a private review link. Enter the access code you were given.
          </p>
          <input
            autoFocus
            type="password"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="access code"
            className="w-full rounded-lg border border-slate-300 bg-surface px-3 py-2 text-slate-900"
          />
          <button
            type="submit"
            disabled={!code.trim()}
            className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-surface disabled:opacity-40"
          >
            Continue
          </button>
        </form>
      </div>
    );
  }

  return <>{children}</>;
}
