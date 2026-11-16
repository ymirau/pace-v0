/**
 * The shared access code for the deployed app.
 *
 * Not authentication: one secret for everyone with the link, no identity and no audit.
 * It exists so a review URL isn't an open tap on the Anthropic bill. Locally the backend
 * leaves `PACE_ACCESS_CODE` empty, the gate is open, and none of this does anything.
 *
 * Kept in localStorage so a reviewer types it once per browser.
 */
const KEY = "pace.accessCode";

export function getAccessCode(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null; // private mode / storage disabled
  }
}

export function setAccessCode(code: string): void {
  try {
    localStorage.setItem(KEY, code.trim());
  } catch {
    /* nothing we can do; the header just won't be sent */
  }
}

export function clearAccessCode(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
