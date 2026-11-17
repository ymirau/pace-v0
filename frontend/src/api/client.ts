import { InteractionRequiredAuthError } from "@azure/msal-browser";

import { getAccessCode } from "../accessCode";
import { getVisitorId } from "../visitor";
import { getViewerCode } from "../viewerCode";
import { apiRequest } from "../authConfig";
import { AUTH_BYPASS } from "../authBypass";
import { reportAuthFailure } from "../authRecovery";
import { msalInstance } from "../msalInstance";

// Rebase "/api/..." under the SPA's per-env deploy base so requests route to
// THIS environment's backend: "/pace-sbx/" + "/api" -> "/pace-sbx/api".
// In local dev BASE_URL is "/", so this is just "/api" (proxied to the backend).
const API_BASE_URL = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

/**
 * Acquire an access token for our API. Tries silent acquisition against the
 * active account; on interaction-required, falls back to a full-page redirect.
 * Any other failure (e.g. the AADSTS90009 stale-session error) is reported so
 * AuthGate shows the recovery page, and rethrown — never redirected.
 */
async function getAccessToken(): Promise<string> {
  const account =
    msalInstance.getActiveAccount() ?? msalInstance.getAllAccounts()[0];
  if (!account) {
    await msalInstance.acquireTokenRedirect(apiRequest);
    // Redirect navigates away; this line is unreachable but satisfies the type.
    throw new Error("Redirecting for authentication");
  }
  try {
    const result = await msalInstance.acquireTokenSilent({
      ...apiRequest,
      account,
    });
    return result.accessToken;
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError) {
      await msalInstance.acquireTokenRedirect(apiRequest);
      throw new Error("Redirecting for authentication", { cause: error });
    }
    reportAuthFailure(error);
    throw error;
  }
}

/**
 * Why a token for a SECONDARY resource could not be had: thrown by
 * {@link acquireTokenSilently} instead of navigating away.
 *
 * `.message` is written to be shown to the user verbatim (the people picker
 * renders it), because the SPA can do nothing about any of these causes: local
 * HTTP dev has no Azure session at all, and an unconsented delegated scope is an
 * Azure admin's decision.
 */
export class TokenUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TokenUnavailableError";
  }
}

/**
 * A token for a resource OTHER than our own API (Microsoft Graph, today).
 *
 * Deliberately **silent-only**, unlike `getAccessToken` above: the caller is a
 * control inside a half-filled form, and `acquireTokenRedirect` is a full-page
 * navigation that would discard everything typed. So an interactive requirement
 * is reported as an error the picker can render beside its input, and the form
 * stays open.
 *
 * MSAL caches per-scope, so repeated calls cost a cache read, not a round trip.
 */
export async function acquireTokenSilently(
  scopes: readonly string[],
): Promise<string> {
  if (AUTH_BYPASS) {
    throw new TokenUnavailableError(
      "this page runs with auth bypassed (HTTP), so there is no Azure session to search with.",
    );
  }
  const account =
    msalInstance.getActiveAccount() ?? msalInstance.getAllAccounts()[0];
  if (!account) {
    throw new TokenUnavailableError(
      "you are not signed in to Azure on this page.",
    );
  }
  try {
    const result = await msalInstance.acquireTokenSilent({
      scopes: [...scopes],
      account,
    });
    return result.accessToken;
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError) {
      throw new TokenUnavailableError(
        `your account has not consented to ${scopes.join(", ")}. An Azure administrator has to grant it.`,
        { cause: error },
      );
    }
    throw error;
  }
}

/**
 * An HTTP error from the API, carrying the status code as data rather than only
 * as the leading token of a message string.
 *
 * A caller has to be able to tell "this record does not exist" (404) apart from
 * "the backend is down" — a detail route renders a not-found state for the
 * first and a retryable failure for the second — and regex-scraping
 * `error.message` for that is how the two silently merge the day the message is
 * reworded. The message keeps its original `"<status> <statusText>: <detail>"`
 * shape so anything already surfacing `(error as Error).message` is unchanged.
 */
export class ApiError extends Error {
  // Declared and assigned separately rather than as constructor parameter
  // properties: tsconfig sets `erasableSyntaxOnly`, so the parameter-property
  // shorthand (the one piece of TS class syntax that emits code) is rejected.
  readonly status: number;
  readonly statusText: string;
  readonly detail: string;

  constructor(status: number, statusText: string, detail: string) {
    super(`${status} ${statusText}: ${detail}`);
    this.name = "ApiError";
    this.status = status;
    this.statusText = statusText;
    this.detail = detail;
  }
}

/** Narrow an unknown caught value to an ApiError (query errors are `unknown`). */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/**
 * The headers every call needs: JSON, the bearer token unless bypassed, and the three
 * Pace-specific ones.
 *
 * Both codes are attached to every request even though no single route wants both. They
 * are checked by different dependencies (`core/gate.py`) and an unexpected one is
 * ignored, so sending both costs two short headers and removes a whole class of bug:
 * a call that needs the viewer code but was written before anyone remembered to pass it.
 */
async function apiHeaders(
  extra?: HeadersInit,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(extra as Record<string, string>),
  };
  if (!AUTH_BYPASS) {
    headers.Authorization = `Bearer ${await getAccessToken()}`;
  }
  // Which browser is asking, so this visitor gets their own world rather than sharing
  // one with every other reviewer. Not an identity — see visitor.ts.
  headers["X-Pace-Visitor"] = getVisitorId();
  // The deployed app's shared gate. Absent locally, where the backend leaves it open.
  const code = getAccessCode();
  if (code) {
    headers["X-Pace-Access-Code"] = code;
  }
  // The log viewer's separate code, for /api/log/*.
  const viewer = getViewerCode();
  if (viewer) {
    headers["X-Pace-Viewer-Code"] = viewer;
  }
  return headers;
}

/**
 * Like {@link apiFetch} but hands back the live {@link Response} instead of parsed
 * JSON, so the caller can read the body as it arrives. Used for the chat's
 * `text/event-stream` turns (`src/api/chat.ts`); an error status is still raised as an
 * {@link ApiError}, because at that point nothing has been streamed yet.
 */
export async function apiStream(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: await apiHeaders(init.headers),
  });
  if (!response.ok) {
    throw new ApiError(
      response.status,
      response.statusText,
      await response.text(),
    );
  }
  if (!response.body) {
    throw new Error(
      "This browser gave no readable body for the streamed reply.",
    );
  }
  return response;
}

/** Fetch wrapper that injects the bearer token (unless bypassed) and JSON headers. */
export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = await apiHeaders(init.headers);
  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });

  if (!response.ok) {
    const detail = await response.text();
    throw new ApiError(response.status, response.statusText, detail);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

/**
 * Upload helper for multipart/form-data (file uploads). Like apiFetch it injects
 * the bearer token, but it does NOT set Content-Type — the browser must set it,
 * including the multipart boundary. Pass a FormData with your file field(s).
 */
export async function apiUpload<T>(
  path: string,
  formData: FormData,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (!AUTH_BYPASS) {
    headers.Authorization = `Bearer ${await getAccessToken()}`;
  }
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    body: formData,
    headers,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new ApiError(response.status, response.statusText, detail);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}
