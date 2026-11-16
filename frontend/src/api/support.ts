import { useMutation, useQuery } from "@tanstack/react-query";

import { apiFetch, apiUpload } from "./client";
import type { SupportKind } from "../lib/supportMail";

/**
 * The support form's API - `/api/support`.
 *
 * Mirrors `backend/app/schemas/support.py` and `routers/support.py`. The app
 * sends the email itself: the recipient is the server's `SUPPORT_EMAIL` (a `to`
 * field would be dropped), Reply-To is the caller's token email, and "sent"
 * means the relay accepted the message. The composed `mailto:` in
 * `lib/supportMail.ts` survives only as the fallback for a failure.
 *
 * Errors: every refusal the router raises is a plain-string `detail` written to
 * be read, so the page shows `ApiError.detail` verbatim.
 */

/** Mirrors `SupportConfig`. `configured` is false when `SUPPORT_EMAIL` is `''`. */
export interface SupportConfig {
  support_email: string;
  configured: boolean;
}

/** Mirrors `SupportSent`: `sent` once the relay accepted the message, `disabled`
 *  when mail is turned off in this environment and nothing went. */
export interface SupportSent {
  status: "sent" | "disabled";
  /** Whether the `support_requests` log row was written. */
  recorded: boolean;
}

/** The multipart fields. `diagnostics` is the pre-rendered lines, one per line;
 *  the server appends it below its own "Sent from…" line. */
export interface SupportSendPayload {
  kind: SupportKind;
  subject: string;
  details: string;
  diagnostics: string;
  /** Resized, already-validated photos (at most 3), each its own `images` part. */
  images: File[];
}

export const supportKeys = {
  all: ["support"] as const,
  config: () => [...supportKeys.all, "config"] as const,
};

/** Where the form sends, and whether it can send at all. */
export function useSupportConfig() {
  return useQuery({
    queryKey: supportKeys.config(),
    queryFn: () => apiFetch<SupportConfig>("/support/config"),
  });
}

/** Send a support request. Multipart (not JSON) because photos ride along. */
export function useSendSupport() {
  return useMutation({
    mutationFn: (payload: SupportSendPayload) => {
      const form = new FormData();
      form.append("kind", payload.kind);
      form.append("subject", payload.subject);
      form.append("details", payload.details);
      form.append("diagnostics", payload.diagnostics);
      for (const image of payload.images) form.append("images", image);
      return apiUpload<SupportSent>("/support", form);
    },
  });
}
