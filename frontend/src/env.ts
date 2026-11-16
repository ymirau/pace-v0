// Environment label derived from the build-time base path. BASE_URL is "/" in
// local dev and "/pace-<env>/" in deployed builds (baked in by vite.config.ts).
// PROD ("/pace/") returns null — no badge, matching the unprefixed prod page
// title. Keep the segment names in sync with baseForTarget in vite.config.ts.
const segment = import.meta.env.BASE_URL.replace(/^\/|\/$/g, "");

export const ENV_LABEL: "loc" | "sbx" | "uat" | null =
  segment === ""
    ? "loc"
    : segment === "pace-sbx"
      ? "sbx"
      : segment === "pace-uat"
        ? "uat"
        : null;

/**
 * Build stamp, as yyyymmdd.hhmmss (e.g. "20260914.142934"), America/Denver time.
 *
 * Baked in by the `define` in vite.config.ts at build time — NOT read from the
 * client's clock, so every viewer of a given build sees the same value. Shown in
 * the sidebar's ⋮ settings menu so you can confirm which build an environment is
 * serving; without it, a stale asset on sbx is indistinguishable from a broken
 * deploy. In `vite dev` it is the moment the dev server started.
 */
export const BUILD_STAMP: string = __BUILD_STAMP__;
