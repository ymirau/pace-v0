/// <reference types="vite/client" />

/**
 * Build stamp (yyyymmdd.hhmmss) substituted by the `define` in vite.config.ts.
 * Declared as a global because `define` does a literal text substitution at
 * build time — it is not part of import.meta.env. Read it via BUILD_STAMP in
 * src/env.ts rather than referencing this directly.
 */
declare const __BUILD_STAMP__: string;
