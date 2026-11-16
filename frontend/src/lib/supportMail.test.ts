import { describe, expect, it } from "vitest";

import {
  diagnosticLines,
  isSendable,
  supportBody,
  supportMailto,
  supportSubject,
} from "./supportMail";

/**
 * Composing the support mailto.
 *
 * The encoding tests are the ones that matter. A raw `#` or `&` in a mailto body
 * truncates it at that character with no error anywhere - the mail client simply
 * opens with half a message - and a support report is exactly the kind of text
 * that contains both.
 */

const context = {
  userName: "Dana Ops",
  envLabel: "sbx",
  buildStamp: "20260916.112714",
  pageUrl: "https://apps.example.com/pace-sbx/items",
  userAgent: "Mozilla/5.0 (iPhone)",
};

const ADDRESS = "help@example.com";

const message = { kind: "Problem" as const, subject: "Cannot add config", body: "The button is gone." };

describe("supportSubject", () => {
  it("tags the environment and kind so a mailbox rule can sort on it", () => {
    expect(supportSubject(message, context)).toBe(
      "[pace-v0 / sbx] Problem: Cannot add config",
    );
  });

  it("says prd when there is no env label", () => {
    // ENV_LABEL is null in prd by design. A blank there would read as a missing
    // value rather than a real one.
    expect(supportSubject(message, { ...context, envLabel: null })).toContain("/ prd]");
  });
});

describe("diagnosticLines", () => {
  it("collects what a support reply would otherwise have to ask for", () => {
    expect(diagnosticLines(context)).toEqual([
      "From: Dana Ops",
      "Environment: sbx",
      "Build: 20260916.112714",
      `Page: ${context.pageUrl}`,
      "Browser: Mozilla/5.0 (iPhone)",
    ]);
  });

  it("omits readings it does not have, rather than writing undefined", () => {
    const lines = diagnosticLines({ userName: "Dana Ops" });
    expect(lines).toContain("From: Dana Ops");
    expect(lines.join("\n")).not.toContain("undefined");
    // Environment still appears: absent means prd, which is a real answer.
    expect(lines).toContain("Environment: prd");
  });
});

describe("supportBody", () => {
  it("leads with the user's words, then the diagnostics", () => {
    const body = supportBody(message, context);
    expect(body.startsWith("The button is gone.")).toBe(true);
    expect(body).toContain("Build: 20260916.112714");
    expect(body.indexOf("The button is gone.")).toBeLessThan(body.indexOf("Build:"));
  });
});

describe("supportMailto", () => {
  it("addresses the resolved support mailbox", () => {
    expect(supportMailto(ADDRESS, message, context).startsWith(`mailto:${ADDRESS}?`)).toBe(true);
  });

  it("encodes characters that would otherwise truncate the body", () => {
    // The failure this prevents: a raw `#` makes everything after it a URL
    // fragment, so the mail client opens with the message cut off at that point
    // and nothing reports an error. `&` ends the body parameter the same way.
    const risky = {
      ...message,
      body: "Filter A&B broke #2 - see https://x.test/a?b=1&c=2",
    };
    const url = supportMailto(ADDRESS, risky, context);
    const body = new URLSearchParams(url.slice(url.indexOf("?") + 1)).get("body");

    expect(body).toContain("Filter A&B broke #2");
    expect(body).toContain("c=2");
  });

  it("keeps newlines intact through the round trip", () => {
    const multiline = { ...message, body: "Line one\nLine two\n\nLine four" };
    const url = supportMailto(ADDRESS, multiline, context);
    const body = new URLSearchParams(url.slice(url.indexOf("?") + 1)).get("body");

    expect(body).toContain("Line one\nLine two\n\nLine four");
  });
});

describe("isSendable", () => {
  it("requires both a subject and a body", () => {
    expect(isSendable(message)).toBe(true);
    expect(isSendable({ ...message, subject: "" })).toBe(false);
    expect(isSendable({ ...message, body: "" })).toBe(false);
  });

  it("rejects whitespace-only input", () => {
    // A mail client handed an empty body opens a blank compose window, and the
    // reason for the report is lost.
    expect(isSendable({ ...message, subject: "   " })).toBe(false);
    expect(isSendable({ ...message, body: "\n\t " })).toBe(false);
  });
});
