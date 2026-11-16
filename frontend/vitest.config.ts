import { defineConfig } from "vitest/config";

// Vitest harness for unit + component tests. The default environment is `node`
// (enough for pure-logic tests like the theme resolver); component tests that
// need a DOM opt into jsdom per-file with a `// @vitest-environment jsdom`
// pragma at the top (see components/ModalForm.test.tsx). Tests live next to the
// code they cover as *.test.ts / *.test.tsx files under src/.
export default defineConfig({
  // vite.config.ts's build-stamp `define` doesn't apply here; give src/env.ts a
  // fixed stand-in so tests importing it don't hit an undefined global.
  define: {
    __BUILD_STAMP__: JSON.stringify("test-build"),
  },
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
