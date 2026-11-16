// @vitest-environment jsdom
import type { AuthError } from "@azure/msal-browser";
import {
  BrowserAuthError,
  BrowserAuthErrorCodes,
  ClientAuthError,
  ClientAuthErrorCodes,
  ServerError,
} from "@azure/msal-browser";
import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loginRequest } from "../authConfig";
import { clearAuthFailure, reportAuthFailure } from "../authRecovery";
import AuthGate from "./AuthGate";

// The template renders its errorComponent with whatever error the test sets,
// standing in for MSAL's failed redirect login.
const template = vi.hoisted(() => ({
  error: null as AuthError | null,
  request: null as unknown,
}));
vi.mock("@azure/msal-react", () => ({
  MsalAuthenticationTemplate: ({
    errorComponent: ErrorComponent,
    authenticationRequest,
    children,
  }: {
    errorComponent: (props: { error: AuthError | null }) => ReactNode;
    authenticationRequest: unknown;
    children: ReactNode;
  }) => {
    template.request = authenticationRequest;
    return template.error ? <ErrorComponent error={template.error} /> : <>{children}</>;
  },
}));
// jsdom serves http://, which would switch AUTH_BYPASS on.
vi.mock("../authBypass", () => ({ AUTH_BYPASS: false }));
// The real msalInstance constructs a PublicClientApplication at module scope.
vi.mock("../msalInstance", () => ({ msalInstance: {} }));

const STALE_SESSION = new ServerError(
  "invalid_request",
  "AADSTS90009: Application '11111111-1111-1111-1111-111111111111'(11111111-1111-1111-1111-111111111111) is requesting a token for itself. This scenario is supported only if resource is specified using the GUID based App Identifier.",
);

afterEach(() => {
  template.error = null;
  clearAuthFailure();
  sessionStorage.clear();
});

describe("AuthGate", () => {
  it("signs in with a password prompt on the second recovery attempt only", () => {
    render(<AuthGate>app content</AuthGate>);
    expect(template.request).toEqual(loginRequest);

    sessionStorage.setItem("pace.authRecovery.attempt", "2");
    render(<AuthGate>app content</AuthGate>);
    expect(template.request).toEqual({ ...loginRequest, prompt: "login" });
  });

  it("clears the attempt and the state_mismatch reload once the signed-in app renders", () => {
    sessionStorage.setItem("pace.authRecovery.attempt", "2");
    sessionStorage.setItem("pace.authRecovery.stateReload", "1");
    render(<AuthGate>app content</AuthGate>);
    expect(screen.getByText("app content")).toBeTruthy();
    expect(sessionStorage.getItem("pace.authRecovery.attempt")).toBeNull();
    expect(sessionStorage.getItem("pace.authRecovery.stateReload")).toBeNull();
  });

  it("keeps the attempt while the recovery page is showing", () => {
    sessionStorage.setItem("pace.authRecovery.attempt", "1");
    template.error = STALE_SESSION;
    render(<AuthGate>app content</AuthGate>);
    expect(sessionStorage.getItem("pace.authRecovery.attempt")).toBe("1");
  });

  it("renders its children when sign-in succeeds", () => {
    render(<AuthGate>app content</AuthGate>);
    expect(screen.getByText("app content")).toBeTruthy();
  });

  it("shows the expired recovery page for the AADSTS90009 stale-session error", () => {
    template.error = STALE_SESSION;
    render(<AuthGate>app content</AuthGate>);
    expect(screen.getByRole("heading", { name: "Your sign-in has expired." })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in again" })).toBeTruthy();
    expect(screen.queryByText(/Authentication error/)).toBeNull();
    expect(screen.queryByText("app content")).toBeNull();
  });

  it("escalates by the recorded recovery attempt", () => {
    sessionStorage.setItem("pace.authRecovery.attempt", "1");
    template.error = STALE_SESSION;
    render(<AuthGate>app content</AuthGate>);
    expect(screen.getByRole("heading", { name: "Sign-in still isn't working." })).toBeTruthy();
  });

  it("shows the offline page for a no_network_connectivity error", () => {
    template.error = new BrowserAuthError(BrowserAuthErrorCodes.noNetworkConnectivity);
    render(<AuthGate>app content</AuthGate>);
    expect(screen.getByRole("heading", { name: "Can't reach sign-in." })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign in again" })).toBeNull();
  });

  it("swaps the app for the recovery page while a mid-session failure is reported", () => {
    render(<AuthGate>app content</AuthGate>);
    expect(screen.getByText("app content")).toBeTruthy();

    act(() => reportAuthFailure(STALE_SESSION));
    expect(screen.getByRole("heading", { name: "Your sign-in has expired." })).toBeTruthy();
    expect(screen.queryByText("app content")).toBeNull();

    act(() => clearAuthFailure());
    expect(screen.getByText("app content")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Your sign-in has expired." })).toBeNull();
  });
});

describe("AuthGate on a state_mismatch", () => {
  const reload = vi.fn();

  afterEach(() => {
    reload.mockReset();
    vi.unstubAllGlobals();
  });

  it("reloads twice, showing Signing in, then shows the recovery page", () => {
    vi.stubGlobal("location", { ...window.location, reload });
    template.error = new ClientAuthError(ClientAuthErrorCodes.stateMismatch);

    for (const times of [1, 2]) {
      const view = render(<AuthGate>app content</AuthGate>);
      expect(screen.getByText("Signing in…")).toBeTruthy();
      expect(reload).toHaveBeenCalledTimes(times);
      view.unmount();
    }

    // Both reloads came back with the same error: the page, not a third reload.
    render(<AuthGate>app content</AuthGate>);
    expect(screen.getByRole("heading", { name: "Your sign-in has expired." })).toBeTruthy();
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
