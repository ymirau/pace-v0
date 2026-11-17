/**
 * The log viewer's code — a different secret from the reviewer's access code.
 *
 * `accessCode.ts` holds the one shared with everybody who has the review link. This one
 * is yours: the log is universal across visitors, so the code that buys a conversation
 * must not also read every other reviewer's transcript and the notes written about the
 * agent's replies. Checked by `PACE_VIEWER_CODE` on the backend.
 *
 * localStorage, like the access code, so it's typed once per browser.
 */
const KEY = "pace.viewerCode";

export function getViewerCode(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setViewerCode(code: string): void {
  try {
    localStorage.setItem(KEY, code.trim());
  } catch {
    /* nothing we can do; the header just won't be sent */
  }
}
