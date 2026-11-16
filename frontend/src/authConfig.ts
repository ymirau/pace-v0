import type { Configuration, PopupRequest, RedirectRequest } from "@azure/msal-browser";

/**
 * MSAL configuration for the SPA app registration (public client, no secret).
 * Every Synveon app and env signs in through one shared Entra registration, so its IDs
 * are constants here rather than per-env settings. They're public client values,
 * safe to ship in the bundle. The backend has the same IDs as defaults in
 * backend/app/core/config.py.
 */
const TENANT_ID = "00000000-0000-0000-0000-000000000000";
const SPA_CLIENT_ID = "11111111-1111-1111-1111-111111111111";
const API_SCOPE = "https://apps.example.com/user_impersonation";

// Every app and env on apps.example.com logs in through ONE shared callback
// path, "/auth-callback/", so Azure needs a single registered SPA redirect URI
// for all of them — adding a new app is Caddy-only, no Azure change. MSAL saves
// the originating URL (e.g. "/pace-sbx/") to localStorage when login starts,
// the callback processes the token, and — because navigateToLoginRequestUrl
// defaults to true — bounces the browser back to where login began. This works
// only because localStorage is keyed by origin (not path) and every app shares
// the one client ID. The trailing slash must match the Azure registration EXACTLY.
const redirectUri = window.location.origin + "/auth-callback/";

export const msalConfig: Configuration = {
  auth: {
    clientId: SPA_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${TENANT_ID}`,
    redirectUri,
    postLogoutRedirectUri: redirectUri,
  },
  cache: {
    // localStorage, not the per-tab session store: the auth state MSAL writes
    // when login starts at the app's path must be readable by the page served
    // at /auth-callback/ — same origin, different path. A per-tab store would
    // not survive that cross-path bounce.
    cacheLocation: "localStorage",
    storeAuthStateInCookie: false,
  },
};

/** Scopes requested at interactive login (identity only). */
export const loginRequest: RedirectRequest & PopupRequest = {
  scopes: ["openid", "profile"],
};

/** Scope for calling our own API. */
export const apiRequest = {
  scopes: [API_SCOPE],
};
