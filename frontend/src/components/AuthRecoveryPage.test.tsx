// @vitest-environment jsdom
import { ServerError } from "@azure/msal-browser";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import AuthRecoveryPage from "./AuthRecoveryPage";

const STALE_SESSION = new ServerError(
  "invalid_request",
  "AADSTS90009: Application '11111111-1111-1111-1111-111111111111'(11111111-1111-1111-1111-111111111111) is requesting a token for itself. This scenario is supported only if resource is specified using the GUID based App Identifier.",
);

function renderPage(props: Partial<Parameters<typeof AuthRecoveryPage>[0]> = {}) {
  const onSignIn = vi.fn();
  const onRetry = vi.fn();
  render(
    <AuthRecoveryPage
      kind="other"
      attempt={0}
      error={STALE_SESSION}
      onSignIn={onSignIn}
      onRetry={onRetry}
      {...props}
    />,
  );
  return { onSignIn, onRetry };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AuthRecoveryPage", () => {
  it("offline: can't-reach heading and Try again, no Sign in again", async () => {
    const { onRetry, onSignIn } = renderPage({ kind: "network" });
    expect(screen.getByRole("heading", { name: "Can't reach sign-in." })).toBeTruthy();
    expect(screen.getByText("Check your connection, then try again.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /sign in/i })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onSignIn).not.toHaveBeenCalled();
  });

  it("expired (attempt 0): Sign in again calls onSignIn", async () => {
    const { onSignIn } = renderPage({ attempt: 0 });
    expect(screen.getByRole("heading", { name: "Your sign-in has expired." })).toBeTruthy();
    expect(screen.getByText("Sign in again to keep working.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Sign in again" }));
    expect(onSignIn).toHaveBeenCalledOnce();
  });

  it("escalated (attempt 1): Sign in with password, no last-resort text", async () => {
    const { onSignIn } = renderPage({ kind: "stuck-interaction", attempt: 1 });
    expect(
      screen.getByRole("heading", { name: "Sign-in still isn't working." }),
    ).toBeTruthy();
    expect(screen.queryByText(/Close your browser/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Sign in with password" }));
    expect(onSignIn).toHaveBeenCalledOnce();
  });

  it("last resort (attempt 2): escalated heading and button plus the close-your-browser text", () => {
    renderPage({ attempt: 2 });
    expect(
      screen.getByRole("heading", { name: "Sign-in still isn't working." }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in with password" })).toBeTruthy();
    expect(
      screen.getByText(
        "Close your browser and open the app again. If it keeps happening, contact IT and include the details below.",
      ),
    ).toBeTruthy();
  });

  it("warns that Sign in again reaches other apps, except when offline", () => {
    renderPage({ kind: "other", attempt: 0 });
    expect(
      screen.getByText(
        "This also signs you out of other Synveon apps in this browser. They'll sign you back in when you open them.",
      ),
    ).toBeTruthy();
  });

  it("offline has no other-apps line", () => {
    renderPage({ kind: "network" });
    expect(screen.queryByText(/also signs you out of other Synveon apps/)).toBeNull();
  });

  it("offline ignores the attempt", () => {
    renderPage({ kind: "network", attempt: 2 });
    expect(screen.getByRole("heading", { name: "Can't reach sign-in." })).toBeTruthy();
    expect(screen.queryByText(/Close your browser/)).toBeNull();
  });

  it("Copy writes the details, including the errorCode, and reads Copied", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...window.navigator, clipboard: { writeText } });
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Show details" }));
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0][0]).toContain("invalid_request");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("a throwing clipboard reads Copy failed", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { ...window.navigator, clipboard: { writeText } });
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Show details" }));
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(await screen.findByRole("button", { name: "Copy failed" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Your sign-in has expired." })).toBeTruthy();
  });
});
