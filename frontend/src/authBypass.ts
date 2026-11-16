/**
 * Skip Azure/MSAL auth. Two ways in, both deliberate.
 *
 * 1. **The page is not served over HTTPS** — local dev and internal HTTP testing.
 *    Azure App Proxy always serves HTTPS in sbx/uat/prod, so this can't fire there.
 *
 * 2. **`VITE_AUTH_BYPASS=true` was set at build time** — the gated Vercel review link.
 *    Vercel serves HTTPS, so the protocol check alone would send a reviewer into an
 *    Azure login whose redirect URI doesn't exist for a `*.vercel.app` hostname, with
 *    an account that may not be in the tenant at all. They'd never reach the app.
 *
 * The second is a **build-time** constant, baked in by Vite, not a runtime switch: a
 * deployed bundle either has it or it doesn't, and nothing an attacker sends can turn
 * it on. The sbx/uat/prod bundles are built by `.gitlab-ci.yml`, which never sets it,
 * so the invariant in CLAUDE.md §4 still holds — those environments keep real auth.
 *
 * On the review link it is not the only thing standing in front of the app: every
 * `/api` route also requires the shared `PACE_ACCESS_CODE` (see `core/gate.py`). That
 * is a bill guard, not authentication, and the pair should never be mistaken for one.
 * Don't set this variable on anything you wouldn't hand to a stranger with the code.
 */
const BUILD_TIME_BYPASS = import.meta.env.VITE_AUTH_BYPASS === "true";

export const AUTH_BYPASS = window.location.protocol !== "https:" || BUILD_TIME_BYPASS;

/** Which of the two it was, so the UI can say so accurately rather than guess. */
export const AUTH_BYPASS_REASON = BUILD_TIME_BYPASS ? "review link" : "local dev";
