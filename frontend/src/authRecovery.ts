import {
  AuthError,
  BrowserAuthError,
  BrowserAuthErrorCodes,
  ClientAuthErrorCodes,
  InteractionRequiredAuthError,
} from "@azure/msal-browser";
import { useSyncExternalStore } from "react";

import { loginRequest } from "./authConfig";

/**
 * What kind of sign-in failure an error is — the one question every auth
 * failure path (AuthGate's errorComponent, the API client's token call) asks,
 * so the same error always gets the same recovery page.
 *
 * - "interaction-required": MSAL needs the user to sign in interactively.
 * - "network": sign-in could not be reached (offline, request failed).
 * - "stuck-interaction": MSAL thinks another sign-in is already running.
 * - "other": anything else, e.g. the AADSTS90009 stale-session ServerError.
 */
export type AuthFailureKind = "interaction-required" | "network" | "stuck-interaction" | "other";

const NETWORK_CODES: ReadonlySet<string> = new Set([
  BrowserAuthErrorCodes.noNetworkConnectivity,
  BrowserAuthErrorCodes.postRequestFailed,
  BrowserAuthErrorCodes.getRequestFailed,
]);

export function classifyAuthError(error: unknown): AuthFailureKind {
  if (error instanceof InteractionRequiredAuthError) return "interaction-required";
  if (error instanceof BrowserAuthError) {
    if (NETWORK_CODES.has(error.errorCode)) return "network";
    if (error.errorCode === BrowserAuthErrorCodes.interactionInProgress) {
      return "stuck-interaction";
    }
    return "other";
  }
  // A fetch that never reached the server rejects with a bare TypeError
  // ("Failed to fetch" in Chromium, "NetworkError when..." in Firefox).
  if (
    error instanceof TypeError &&
    (error.message.startsWith("Failed to fetch") || error.message.startsWith("NetworkError"))
  ) {
    return "network";
  }
  return "other";
}

/** How many times "Sign in again" has been pressed since the last good sign-in. */
export type RecoveryAttempt = 0 | 1 | 2;

// Per-app keys: every app shares the apps.example.com origin, so apps opened
// in one tab share this sessionStorage. /syn-init-webapp renames "pace" to
// the app's slug, which keeps one app's counters out of another's.
const ATTEMPT_KEY = "pace.authRecovery.attempt";
// MSAL's temporary sign-in state (the redirect's state, nonce, verifier and the
// "a redirect is already running" flag). msal-browser 4.x keeps it in this
// tab's sessionStorage under "msal." keys. Left behind by an interrupted or
// failed redirect, it breaks the next sign-in (interaction_in_progress, or a
// "State mismatch error" when the response comes back).
const MSAL_TEMP_PREFIX = "msal.";
// msal-browser 4.x encrypts its localStorage cache with a key held in this
// browser-session cookie. Without it, the next page load generates a new key,
// cannot decrypt the old entries and deletes them: a clean sign-in, which is
// exactly what closing the whole browser did (confirmed by hand on sbx,
// 2026-09-28, after a partial clean-up still failed with State mismatch).
const ENCRYPTION_COOKIE = "msal.cache.encryption";

// sessionStorage can throw (privacy modes, storage disabled); recovery must
// still work, it just stops escalating.
export function getRecoveryAttempt(): RecoveryAttempt {
  try {
    const value = sessionStorage.getItem(ATTEMPT_KEY);
    return value === "1" ? 1 : value === "2" ? 2 : 0;
  } catch {
    return 0;
  }
}

function setRecoveryAttempt(attempt: RecoveryAttempt): void {
  try {
    if (attempt === 0) sessionStorage.removeItem(ATTEMPT_KEY);
    else sessionStorage.setItem(ATTEMPT_KEY, String(attempt));
  } catch {
    // Ignored: see getRecoveryAttempt.
  }
}

export function resetRecoveryAttempt(): void {
  setRecoveryAttempt(0);
  try {
    sessionStorage.removeItem(STATE_RELOAD_KEY);
  } catch {
    // Ignored: see getRecoveryAttempt.
  }
}

// How many times this tab has auto-reloaded for a state_mismatch; cleared by a
// good sign-in and by each "Sign in again".
const STATE_RELOAD_KEY = "pace.authRecovery.stateReload";
// Two, not one: on sbx (2026-09-28) the mismatch sometimes came back on the
// first reload too (2 runs in 5), and a further reload then signed in.
const MAX_STATE_RELOADS = 2;

// The reloads used so far; null when sessionStorage can't be read.
function stateReloadsUsed(): number | null {
  try {
    const n = Number(sessionStorage.getItem(STATE_RELOAD_KEY) ?? "0");
    return Number.isInteger(n) && n >= 0 ? n : MAX_STATE_RELOADS;
  } catch {
    return null;
  }
}

/**
 * A "State mismatch error" on the first sign-in after a reset is transient:
 * seen on sbx 2026-09-28, where a plain reload of that page then signed in.
 * So AuthGate reloads for it (up to MAX_STATE_RELOADS per tab) before showing
 * the recovery page.
 */
export function isStateMismatch(error: unknown): boolean {
  return error instanceof AuthError && error.errorCode === ClientAuthErrorCodes.stateMismatch;
}

/** Whether this tab has an automatic reload left (reads only). */
export function stateMismatchReloadAvailable(): boolean {
  const used = stateReloadsUsed();
  return used !== null && used < MAX_STATE_RELOADS;
}

/**
 * Claim one of this tab's automatic reloads. False when they are used up, or
 * when sessionStorage can't record it (no cap means no auto-reload, never a loop).
 */
export function claimStateMismatchReload(): boolean {
  try {
    const used = stateReloadsUsed();
    if (used === null || used >= MAX_STATE_RELOADS) return false;
    const next = String(used + 1);
    sessionStorage.setItem(STATE_RELOAD_KEY, next);
    return sessionStorage.getItem(STATE_RELOAD_KEY) === next;
  } catch {
    return false;
  }
}

/** Drop every MSAL temporary key in this tab's sessionStorage. */
function clearMsalTemporaryState(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(MSAL_TEMP_PREFIX)) keys.push(key);
    }
    for (const key of keys) sessionStorage.removeItem(key);
  } catch {
    // Storage unavailable: nothing to clear.
  }
}

/** Expire MSAL's cache encryption cookie, the way MSAL itself removes it. */
function expireEncryptionCookie(): void {
  document.cookie = `${ENCRYPTION_COOKIE}=;path=/;SameSite=None;Secure;max-age=0`;
}

/**
 * The sign-in request for this page load: the second "Sign in again" in a row
 * forces a password prompt, which gets past a stale Microsoft session.
 */
export function recoveryLoginRequest(): typeof loginRequest {
  return getRecoveryAttempt() === 2 ? { ...loginRequest, prompt: "login" } : loginRequest;
}

/**
 * "Sign in again": the same reset closing the browser gives. Clear this tab's
 * MSAL temporary state, expire the cache encryption cookie, record the attempt,
 * then reload. On the reload MSAL starts with a fresh key, discards the old
 * (now unreadable) cache, finds no account, and AuthGate's template signs in
 * with recoveryLoginRequest().
 *
 * The cache is shared by every app on apps.example.com, so this signs all of
 * them out locally, as a browser restart does; each signs in again (usually
 * without a password) on its next load. The reload is required: the running
 * MSAL instance still holds the old key and cache in memory.
 */
export function startRecovery(reload: () => void = () => window.location.reload()): void {
  clearMsalTemporaryState();
  expireEncryptionCookie();
  // Recorded before reloading, and outside the "msal." prefix cleared above.
  setRecoveryAttempt(getRecoveryAttempt() >= 1 ? 2 : 1);
  // Each click gets its own automatic state_mismatch reload.
  try {
    sessionStorage.removeItem(STATE_RELOAD_KEY);
  } catch {
    // Ignored: see getRecoveryAttempt.
  }
  reload();
}

// A token failure raised mid-session by the API client, outside React. AuthGate
// subscribes and swaps the page for the recovery page while one is set.
let authFailure: unknown | null = null;
const authFailureListeners = new Set<() => void>();

function setAuthFailure(error: unknown | null): void {
  authFailure = error;
  for (const listener of authFailureListeners) listener();
}

/** Report a token failure the API client could not recover from silently. */
export function reportAuthFailure(error: unknown): void {
  setAuthFailure(error);
}

export function clearAuthFailure(): void {
  setAuthFailure(null);
}

function subscribeAuthFailure(listener: () => void): () => void {
  authFailureListeners.add(listener);
  return () => authFailureListeners.delete(listener);
}

function getAuthFailure(): unknown | null {
  return authFailure;
}

/** The last reported mid-session token failure, or null. */
export function useAuthFailure(): unknown | null {
  return useSyncExternalStore(subscribeAuthFailure, getAuthFailure, getAuthFailure);
}
