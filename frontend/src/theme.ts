// Theme resolution, persistence, and live OS-follow for the light/dark palette.
//
// The actual palette lives in index.css: setting data-theme="dark" on <html>
// flips every slate/accent utility (Tailwind v4 resolves var(--color-*) at
// use-time). This module owns *which* theme is active:
//   precedence = manual stored choice > OS prefers-color-scheme > light default
//
// A no-FOUC bootstrap in index.html applies the resolved theme before this
// bundle loads; initTheme() re-applies it and starts following the OS live.
// Keep resolveTheme pure (no DOM/storage) so it's unit-testable under node.

import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "theme";
const OS_DARK_QUERY = "(prefers-color-scheme: dark)";

function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

/**
 * Pure theme resolution. A valid manual choice wins; otherwise fall back to the
 * OS preference; light is the implicit default when the OS prefers light.
 */
export function resolveTheme(stored: string | null, osPrefersDark: boolean): Theme {
  if (isTheme(stored)) return stored;
  return osPrefersDark ? "dark" : "light";
}

function apply(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

/** The manual choice persisted in localStorage, or null if none/invalid. */
export function getStoredTheme(): Theme | null {
  const stored = localStorage.getItem(STORAGE_KEY);
  return isTheme(stored) ? stored : null;
}

/** The theme currently applied to <html>, resolving from scratch if unset. */
export function getTheme(): Theme {
  const attr = document.documentElement.dataset.theme;
  if (isTheme(attr)) return attr;
  return resolveTheme(getStoredTheme(), window.matchMedia(OS_DARK_QUERY).matches);
}

/** Record a manual theme choice: apply it, persist it, and return it. */
export function setTheme(theme: Theme): Theme {
  apply(theme);
  localStorage.setItem(STORAGE_KEY, theme);
  return theme;
}

/** Flip light<->dark and persist the result as the manual override. */
export function toggleTheme(): Theme {
  return setTheme(getTheme() === "dark" ? "light" : "dark");
}

/**
 * Initialise theming at startup: apply the resolved theme, then follow the OS
 * preference live — but only while the user hasn't made a manual choice.
 */
export function initTheme(): void {
  const mql = window.matchMedia(OS_DARK_QUERY);
  apply(resolveTheme(getStoredTheme(), mql.matches));
  mql.addEventListener("change", (event) => {
    if (getStoredTheme() === null) apply(event.matches ? "dark" : "light");
  });
}

function subscribeToTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}

/**
 * React binding for the active theme. Backed by a MutationObserver on the
 * <html data-theme> attribute, so it re-renders whenever the theme flips — the
 * sidebar toggle, the live OS-follow, anything. Use this when a component needs
 * theme-derived values that CSS can't express (e.g. canvas/chart colors).
 */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribeToTheme, getTheme, getTheme);
}
