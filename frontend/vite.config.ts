import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// All three deploy envs are served from one host (app-server-02) behind one
// hostname (apps.example.com), distinguished by URL path:
//   prod -> /pace/   uat -> /pace-uat/   sbx -> /pace-sbx/
// The base path is baked into the build so asset URLs and API calls resolve to
// the right env. Caddy routes <base>api/* to that env's FastAPI and serves the
// SPA from <base>*. API calls go through src/api/client.ts, which prefixes
// import.meta.env.BASE_URL — so no per-env API base var is needed.
//
// Local dev sets no BUILD_TARGET, so base is "/" and the app serves at the
// root (http://localhost:5173) — simpler than the deployed sub-path.
type BuildTarget = "prod" | "uat" | "sbx";

const baseForTarget: Record<BuildTarget, string> = {
  prod: "/pace/",
  uat: "/pace-uat/",
  sbx: "/pace-sbx/",
};

// Browser-tab title. Every env except prod is prefixed so it's obvious which one
// a tab points at ("loc - " local dev/build, "sbx - …", "uat - …"); prod shows the
// bare name. Rename APP_TITLE when you rename the app.
const APP_TITLE = "pace-v0";
const LOCAL_TITLE_PREFIX = "loc - ";
const titlePrefixForTarget: Record<BuildTarget, string> = {
  prod: "",
  uat: "uat - ",
  sbx: "sbx - ",
};

export default defineConfig(({ mode }) => {
  // Make VITE_* (and plain) env vars available for config-time reads.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));

  const buildTarget = process.env.BUILD_TARGET as BuildTarget | undefined;
  const base = buildTarget ? baseForTarget[buildTarget] : "/";
  // Prefix without trailing slash, e.g. "/pace-sbx" ("" in local dev).
  const basePrefix = base.replace(/\/$/, "");

  const pageTitle =
    (buildTarget ? titlePrefixForTarget[buildTarget] : LOCAL_TITLE_PREFIX) + APP_TITLE;

  // Build stamp, as yyyymmdd.hhmmss (e.g. 20260914.142934), so a problem report
  // names the exact build it came from. Computed HERE, at config evaluation, so
  // `define` freezes it into the bundle rather than reading the client's clock.
  // In `vite dev` it is the moment the dev server started and stays put across
  // HMR updates — there is no "build" in dev.
  //
  // Pinned to America/Denver (not the build machine's zone, not UTC): the format
  // carries no offset, so a local build and a CI build are only comparable if
  // both read the same clock. Intl handles MST/MDT; en-CA gives ISO-ordered
  // parts, and hourCycle "h23" stops midnight formatting as "24".
  const stampParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(new Date())
    .reduce<Record<string, string>>((acc, { type, value }) => {
      acc[type] = value;
      return acc;
    }, {});

  const BUILD_STAMP =
    `${stampParts.year}${stampParts.month}${stampParts.day}` +
    `.${stampParts.hour}${stampParts.minute}${stampParts.second}`;

  return {
    plugins: [
      react(),
      tailwindcss(),
      // Bake the (possibly env-prefixed) title into index.html at build time.
      {
        name: "html-page-title",
        transformIndexHtml: (html: string) =>
          html.replace(/<title>[^<]*<\/title>/, `<title>${pageTitle}</title>`),
      },
    ],
    base,
    define: {
      __BUILD_STAMP__: JSON.stringify(BUILD_STAMP),
    },
    server: {
      port: 5173,
      // Mirror Caddy: the dev server serves under <base>, so API calls arrive as
      // <base>/api/*. Strip the env prefix and forward to the FastAPI backend,
      // which serves routes under /api/*. No CORS in dev (same origin).
      proxy: {
        [`${basePrefix}/api`]: {
          // Point at another backend by exporting VITE_API_UPSTREAM in your shell or
          // setting it in a git-ignored frontend/.env.development.local.
          target: process.env.VITE_API_UPSTREAM || "http://127.0.0.1:8000",
          changeOrigin: true,
          rewrite: (path) => path.replace(basePrefix, ""),
        },
      },
    },
  };
});
