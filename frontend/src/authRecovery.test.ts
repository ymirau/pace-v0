// @vitest-environment jsdom
import {
  AuthError,
  BrowserAuthError,
  BrowserAuthErrorCodes,
  ClientAuthError,
  ClientAuthErrorCodes,
  InteractionRequiredAuthError,
  ServerError,
} from "@azure/msal-browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loginRequest } from "./authConfig";
import {
  claimStateMismatchReload,
  classifyAuthError,
  getRecoveryAttempt,
  isStateMismatch,
  recoveryLoginRequest,
  resetRecoveryAttempt,
  startRecovery,
  stateMismatchReloadAvailable,
} from "./authRecovery";

// Replace the global sessionStorage with one that throws on every use. Stub the
// global rather than spying on Storage.prototype: on Node 25+ the global is
// Node's own Web Storage, not jsdom's, so a prototype spy never fires.
function stubThrowingSessionStorage() {
  const boom = () => {
    throw new Error("storage disabled");
  };
  vi.stubGlobal("sessionStorage", {
    getItem: boom,
    setItem: boom,
    removeItem: boom,
    key: boom,
    clear: boom,
    get length(): number {
      return boom();
    },
  });
}

const AADSTS90009 =
  "AADSTS90009: Application '11111111-1111-1111-1111-111111111111'(11111111-1111-1111-1111-111111111111) is requesting a token for itself. This scenario is supported only if resource is specified using the GUID based App Identifier.";

describe("classifyAuthError", () => {
  it("classifies any InteractionRequiredAuthError as interaction-required", () => {
    expect(classifyAuthError(new InteractionRequiredAuthError("interaction_required"))).toBe(
      "interaction-required",
    );
    expect(classifyAuthError(new InteractionRequiredAuthError("login_required"))).toBe(
      "interaction-required",
    );
    expect(classifyAuthError(new InteractionRequiredAuthError("some_new_code"))).toBe(
      "interaction-required",
    );
  });

  it.each([
    BrowserAuthErrorCodes.noNetworkConnectivity,
    BrowserAuthErrorCodes.postRequestFailed,
    BrowserAuthErrorCodes.getRequestFailed,
  ])("classifies BrowserAuthError %s as network", (code) => {
    expect(classifyAuthError(new BrowserAuthError(code))).toBe("network");
  });

  it("classifies a fetch TypeError as network", () => {
    expect(classifyAuthError(new TypeError("Failed to fetch"))).toBe("network");
    expect(
      classifyAuthError(new TypeError("NetworkError when attempting to fetch resource.")),
    ).toBe("network");
  });

  it("does not treat an unrelated TypeError as network", () => {
    expect(classifyAuthError(new TypeError("x is not a function"))).toBe("other");
  });

  it("classifies BrowserAuthError interaction_in_progress as stuck-interaction", () => {
    expect(
      classifyAuthError(new BrowserAuthError(BrowserAuthErrorCodes.interactionInProgress)),
    ).toBe("stuck-interaction");
  });

  it("classifies the AADSTS90009 ServerError as other", () => {
    const error = new ServerError("invalid_request", AADSTS90009, "90009");
    expect(classifyAuthError(error)).toBe("other");
  });

  it.each([
    ["a plain Error", new Error("boom")],
    ["undefined", undefined],
  ])("classifies %s as other", (_label, value) => {
    expect(classifyAuthError(value)).toBe("other");
  });
});

describe("recovery attempt and startRecovery", () => {
  const ATTEMPT_KEY = "pace.authRecovery.attempt";
  let reload: ReturnType<typeof vi.fn<() => void>>;
  let cookieWrites: string[];

  beforeEach(() => {
    sessionStorage.clear();
    reload = vi.fn<() => void>();
    cookieWrites = [];
    vi.spyOn(document, "cookie", "set").mockImplementation((value: string) => {
      cookieWrites.push(value);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("starts at 0 and reads an invalid stored value as 0", () => {
    expect(getRecoveryAttempt()).toBe(0);
    sessionStorage.setItem(ATTEMPT_KEY, "7");
    expect(getRecoveryAttempt()).toBe(0);
  });

  it("clears MSAL's temporary state, expires the encryption cookie, records the attempt, then reloads", () => {
    sessionStorage.setItem("msal.interaction.status", '{"clientId":"x"}');
    sessionStorage.setItem("msal.11111111.request.params", "stale");
    sessionStorage.setItem("unrelated", "kept");
    reload.mockImplementation(() => {
      expect(sessionStorage.getItem("msal.interaction.status")).toBeNull();
      expect(sessionStorage.getItem("msal.11111111.request.params")).toBeNull();
      expect(cookieWrites).toEqual(["msal.cache.encryption=;path=/;SameSite=None;Secure;max-age=0"]);
      expect(getRecoveryAttempt()).toBe(1);
    });

    startRecovery(reload);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("unrelated")).toBe("kept");
  });

  it("asks for a password prompt only once the attempt reaches 2, and caps at 2", () => {
    expect(recoveryLoginRequest()).toEqual(loginRequest);

    startRecovery(reload);
    expect(getRecoveryAttempt()).toBe(1);
    expect(recoveryLoginRequest()).toEqual(loginRequest);

    startRecovery(reload);
    expect(getRecoveryAttempt()).toBe(2);
    expect(recoveryLoginRequest()).toEqual({ ...loginRequest, prompt: "login" });

    startRecovery(reload);
    expect(getRecoveryAttempt()).toBe(2);
  });

  it("resetRecoveryAttempt returns the attempt to 0", () => {
    startRecovery(reload);
    startRecovery(reload);
    resetRecoveryAttempt();
    expect(getRecoveryAttempt()).toBe(0);
    expect(recoveryLoginRequest()).toEqual(loginRequest);
  });

  it("survives a throwing sessionStorage and still resets and reloads", () => {
    stubThrowingSessionStorage();

    expect(getRecoveryAttempt()).toBe(0);
    expect(() => resetRecoveryAttempt()).not.toThrow();
    expect(() => startRecovery(reload)).not.toThrow();
    expect(cookieWrites).toHaveLength(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("the one automatic state_mismatch reload", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.spyOn(document, "cookie", "set").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("recognises only MSAL's state_mismatch", () => {
    expect(isStateMismatch(new ClientAuthError(ClientAuthErrorCodes.stateMismatch))).toBe(true);
    expect(isStateMismatch(new ClientAuthError(ClientAuthErrorCodes.stateNotFound))).toBe(false);
    expect(isStateMismatch(new AuthError("state_mismatch_other"))).toBe(false);
    expect(isStateMismatch(new Error("state_mismatch"))).toBe(false);
  });

  it("can be claimed twice per tab, then no more", () => {
    expect(stateMismatchReloadAvailable()).toBe(true);
    expect(claimStateMismatchReload()).toBe(true);
    expect(stateMismatchReloadAvailable()).toBe(true);
    expect(claimStateMismatchReload()).toBe(true);
    expect(stateMismatchReloadAvailable()).toBe(false);
    expect(claimStateMismatchReload()).toBe(false);
  });

  it("treats a garbled count as used up", () => {
    sessionStorage.setItem("pace.authRecovery.stateReload", "lots");
    expect(stateMismatchReloadAvailable()).toBe(false);
    expect(claimStateMismatchReload()).toBe(false);
  });

  it("is given back by a good sign-in and by each Sign in again", () => {
    claimStateMismatchReload();
    resetRecoveryAttempt();
    expect(stateMismatchReloadAvailable()).toBe(true);

    claimStateMismatchReload();
    startRecovery(() => {});
    expect(stateMismatchReloadAvailable()).toBe(true);
  });

  it("is never available when sessionStorage throws, so it cannot loop", () => {
    stubThrowingSessionStorage();
    expect(stateMismatchReloadAvailable()).toBe(false);
    expect(claimStateMismatchReload()).toBe(false);
  });
});
