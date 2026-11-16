import { MsalAuthenticationTemplate } from "@azure/msal-react";
import { InteractionType } from "@azure/msal-browser";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { AUTH_BYPASS } from "../authBypass";
import {
  claimStateMismatchReload,
  classifyAuthError,
  getRecoveryAttempt,
  isStateMismatch,
  resetRecoveryAttempt,
  stateMismatchReloadAvailable,
  recoveryLoginRequest,
  startRecovery,
  useAuthFailure,
} from "../authRecovery";
import AuthRecoveryPage from "./AuthRecoveryPage";

/**
 * Gates its children behind an authenticated Azure session. Unauthenticated
 * users are sent through a full-page redirect login. Any authenticated user is
 * allowed through — there is no role check. A failed sign-in (e.g. the
 * AADSTS90009 stale-session error) shows the recovery page, not the raw error,
 * and so does an API token failure reported mid-session (reportAuthFailure).
 *
 * When AUTH_BYPASS is set (non-HTTPS / local dev), MSAL is skipped entirely.
 */
export default function AuthGate({ children }: { children: ReactNode }) {
  // Read once per page load: the attempt only changes across a reload.
  const authenticationRequest = useMemo(() => recoveryLoginRequest(), []);

  if (AUTH_BYPASS) {
    return <>{children}</>;
  }

  return (
    <MsalAuthenticationTemplate
      interactionType={InteractionType.Redirect}
      authenticationRequest={authenticationRequest}
      loadingComponent={() => <FullPage>Signing in…</FullPage>}
      errorComponent={({ error }) => <Recovery error={error} />}
    >
      <SessionGuard>{children}</SessionGuard>
    </MsalAuthenticationTemplate>
  );
}

/**
 * Swaps the signed-in app for the recovery page while a token failure is
 * reported. Mounting it means sign-in worked, so it also ends any "Sign in
 * again" escalation and gives back the state_mismatch reload. That can't hang
 * off MSAL's LOGIN_SUCCESS: with the shared /auth-callback/, the callback page's
 * own MSAL handles the response, and this app only finds the cached result
 * (seen on sbx 2026-09-28: the counters survived a successful sign-in).
 */
function SessionGuard({ children }: { children: ReactNode }) {
  const failure = useAuthFailure();
  useEffect(() => {
    resetRecoveryAttempt();
  }, []);
  return failure === null ? <>{children}</> : <Recovery error={failure} />;
}

function Recovery({ error }: { error: unknown }) {
  // Decided at render by a read-only check; claimed (and reloaded) in the
  // effect, so a StrictMode double render cannot use the reload up.
  const [autoReload, setAutoReload] = useState(
    () => isStateMismatch(error) && stateMismatchReloadAvailable(),
  );
  useEffect(() => {
    if (!autoReload) return;
    if (claimStateMismatchReload()) window.location.reload();
    // Could not record the reload (storage failed): show the page instead.
    else queueMicrotask(() => setAutoReload(false));
  }, [autoReload]);

  if (autoReload) return <FullPage>Signing in…</FullPage>;
  return (
    <AuthRecoveryPage
      kind={classifyAuthError(error)}
      attempt={getRecoveryAttempt()}
      error={error}
      onSignIn={() => startRecovery()}
      onRetry={() => window.location.reload()}
    />
  );
}

function FullPage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center text-sm text-slate-600">
      {children}
    </div>
  );
}
