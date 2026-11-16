import { AuthError } from "@azure/msal-browser";
import { useState } from "react";

import type { AuthFailureKind } from "../authRecovery";
import { btnClass, btnPrimaryClass } from "./ModalForm";

interface AuthRecoveryPageProps {
  kind: AuthFailureKind;
  attempt: 0 | 1 | 2;
  error: unknown;
  onSignIn: () => void;
  onRetry: () => void;
}

/**
 * What a user sees when sign-in fails: a plain message and one button that
 * fixes it. "network" gets the offline message and a reload; every other kind
 * gets Sign in again, which escalates with the recovery attempt (attempt 1
 * forces a password prompt, attempt 2 adds the close-your-browser advice).
 * Under the sign-in button, a line warns that the reset reaches every app on
 * apps.example.com: they share MSAL's cache, so all of them sign in again.
 * The raw error stays behind "Show details" for support.
 *
 * Presentational only — the caller classifies the error and supplies the
 * actions (see authRecovery.ts).
 */
export default function AuthRecoveryPage({
  kind,
  attempt,
  error,
  onSignIn,
  onRetry,
}: AuthRecoveryPageProps) {
  const offline = kind === "network";
  const escalated = !offline && attempt > 0;

  const heading = offline
    ? "Can't reach sign-in."
    : escalated
      ? "Sign-in still isn't working."
      : "Your sign-in has expired.";
  const text = offline
    ? "Check your connection, then try again."
    : attempt === 2
      ? "Close your browser and open the app again. If it keeps happening, contact IT and include the details below."
      : escalated
        ? null
        : "Sign in again to keep working.";

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-base font-semibold text-slate-900">{heading}</h1>
        {text && <p className="text-sm text-slate-600">{text}</p>}
        <div className="flex justify-center">
          {offline ? (
            <button type="button" className={btnPrimaryClass} onClick={onRetry}>
              Try again
            </button>
          ) : (
            <button type="button" className={btnPrimaryClass} onClick={onSignIn}>
              {escalated ? "Sign in with password" : "Sign in again"}
            </button>
          )}
        </div>
        {!offline && (
          <p className="text-xs text-slate-500">
            This also signs you out of other Synveon apps in this browser. They'll sign you back in when you open them.
          </p>
        )}
        <ErrorDetails error={error} />
      </div>
    </div>
  );
}

/** The support-facing error text: MSAL's code, message and correlation id. */
function describeError(error: unknown): string {
  if (error instanceof AuthError) {
    return [
      `Code: ${error.errorCode}`,
      `Message: ${error.errorMessage}`,
      `Correlation ID: ${error.correlationId || "none"}`,
    ].join("\n");
  }
  return String(error);
}

type CopyState = "idle" | "copied" | "failed";

function ErrorDetails({ error }: { error: unknown }) {
  const [open, setOpen] = useState(false);
  const [copy, setCopy] = useState<CopyState>("idle");
  const details = describeError(error);

  async function handleCopy() {
    try {
      // navigator.clipboard is absent on insecure origins and some webviews.
      await navigator.clipboard.writeText(details);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  }

  return (
    <div className="text-left">
      <button
        type="button"
        className="mx-auto block text-xs text-slate-600 underline hover:text-slate-900"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "Hide details" : "Show details"}
      </button>
      {open && (
        <div className="mt-2 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
          <pre className="whitespace-pre-wrap break-words text-[11px] text-slate-700">
            {details}
          </pre>
          <button type="button" className={btnClass} onClick={handleCopy}>
            {copy === "copied" ? "Copied" : copy === "failed" ? "Copy failed" : "Copy"}
          </button>
        </div>
      )}
    </div>
  );
}
