/**
 * The support message's shared pieces: kinds, diagnostics, and the `mailto:`
 * fallback.
 *
 * Pure string work, in its own module with no React or env imports, so it
 * unit-tests in the node-only harness.
 *
 * ## The mailto: is only the fallback
 *
 * The page sends through the API (`api/support.ts`); the backend emails support
 * itself. `supportMailto` is kept for when that send fails: it opens the user's
 * own mail client with the message prefilled, and **they** have to press send.
 * The address comes from `/api/support/config` (`SUPPORT_EMAIL`), never from a
 * constant here, so the fallback goes where the server would have sent it.
 */

/** What the sender is describing. Kept short - this becomes the subject tag. */
export const SUPPORT_KINDS = ["Problem", "Question", "Request"] as const;
export type SupportKind = (typeof SUPPORT_KINDS)[number];

export interface SupportContext {
  /** Display name of the signed-in user, when there is one. */
  userName?: string;
  /** Which environment the report is from (sbx/loc), or null in prd. */
  envLabel?: string | null;
  /** Build stamp, so a fixed-in-a-later-build report is identifiable. */
  buildStamp?: string;
  /** The page they were on. */
  pageUrl?: string;
  /** Browser/OS string. */
  userAgent?: string;
}

export interface SupportMessage {
  kind: SupportKind;
  subject: string;
  body: string;
}

/**
 * The diagnostic block appended to every report.
 *
 * These are the questions a support reply otherwise opens with - which
 * environment, which build, which screen - and the sender frequently cannot
 * answer them (the build stamp is not something anyone memorises). Collecting them automatically is most of the
 * value of having a form at all rather than a bare mailto: link.
 *
 * Omits anything absent rather than writing "undefined", so a line that appears
 * is always a real reading.
 */
export function diagnosticLines(context: SupportContext): string[] {
  const rows: [string, string | null | undefined][] = [
    ["From", context.userName],
    // "prd" rather than an empty value: ENV_LABEL is null there by design, and
    // a blank line would read as a missing reading instead of a real one.
    ["Environment", context.envLabel ?? "prd"],
    ["Build", context.buildStamp],
    ["Page", context.pageUrl],
    ["Browser", context.userAgent],
  ];
  return rows
    .filter((row): row is [string, string] => Boolean(row[1]))
    .map(([label, value]) => `${label}: ${value}`);
}

/** The app's name in the subject tag and footer. Must match APP_NAME in the
 *  backend's routers/support.py, which tags the emails it sends the same way. */
const APP_NAME = "pace-v0";

/** The subject line: tagged by kind so a mailbox rule can sort on it. */
export function supportSubject(message: SupportMessage, context: SupportContext): string {
  const env = context.envLabel ?? "prd";
  return `[${APP_NAME} / ${env}] ${message.kind}: ${message.subject}`;
}

/** The full plain-text body - the user's words, then the diagnostics. */
export function supportBody(message: SupportMessage, context: SupportContext): string {
  return [
    message.body.trim(),
    "",
    "---",
    `From the ${APP_NAME} support form.`,
    ...diagnosticLines(context),
  ].join("\n");
}

/**
 * The complete `mailto:` URL.
 *
 * `encodeURIComponent`, not `encodeURI`: the body contains newlines, `&` and
 * `#`, every one of which silently truncates the body at that character if left
 * raw - `#` in particular turns the remainder into a fragment and it vanishes
 * with no error anywhere.
 */
export function supportMailto(
  address: string,
  message: SupportMessage,
  context: SupportContext,
): string {
  const subject = encodeURIComponent(supportSubject(message, context));
  const body = encodeURIComponent(supportBody(message, context));
  return `mailto:${address}?subject=${subject}&body=${body}`;
}

/**
 * Whether the form may be submitted: a subject and a body, both non-blank.
 *
 * Whitespace-only fails, because a mail client given an empty body opens a
 * blank compose window and the reason for the report is lost.
 */
export function isSendable(message: SupportMessage): boolean {
  return message.subject.trim().length > 0 && message.body.trim().length > 0;
}
