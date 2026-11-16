import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocked before graph.ts is imported: the real client.ts reaches msalInstance,
// which constructs a PublicClientApplication at module scope. A plain factory
// (not a spread of importOriginal) is deliberate here — graph.ts imports one
// function from it and does no `instanceof` on anything else, so nothing real is
// needed and nothing real is executed.
vi.mock("./client", () => ({
  apiFetch: vi.fn(),
  apiUpload: vi.fn(),
  acquireTokenSilently: vi.fn(),
}));

import { acquireTokenSilently } from "./client";
import {
  directorySearchExpression,
  directorySearchUrl,
  GRAPH_USER_SCOPES,
  GraphError,
  personEmail,
  searchDirectory,
} from "./graph";

/**
 * The Graph request contract, asserted without a network.
 *
 * Everything here is a property of the *request* — the search expression, the
 * mandatory header, the scope asked for — plus the mapping of a failed response
 * onto a sentence. None of it is visible from the component test, and all of it
 * is the difference between a picker that works in the tenant and one that
 * answers 400 forever.
 */

const tokenMock = vi.mocked(acquireTokenSilently);
const fetchMock = vi.fn();

/** A Graph response, ok or not. */
function graphResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const status = init.status ?? 200;
  return {
    ok: init.ok ?? status < 400,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
  } as Response;
}

const GRAPH_USER = {
  id: "aad-1",
  displayName: "Kevin Choe",
  mail: "senzero@gmail.com",
  userPrincipalName: "senzero@gmail.com",
  jobTitle: "Engineer",
  department: "Operations",
};

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  tokenMock.mockReset();
  tokenMock.mockResolvedValue("graph-token");
});

afterEach(() => vi.unstubAllGlobals());

describe("directorySearchExpression", () => {
  it("searches both the display name and the mail address", () => {
    // startswith(displayName, …) would never find "Kevin Choe" from "choe";
    // $search is tokenised, and people look each other up by either field.
    expect(directorySearchExpression("choe")).toBe('"displayName:choe" OR "mail:choe"');
  });

  it("neutralises the quote and backslash that would break the OData literal", () => {
    // A pasted "Kevin Choe" (with quotes) or a stray backslash would end the
    // quoted string early — a 400, not a bad result. Same class of bug as the
    // backend's _escape_like.
    expect(directorySearchExpression('ke"vin')).toBe('"displayName:ke vin" OR "mail:ke vin"');
    expect(directorySearchExpression("ke\\vin")).toBe('"displayName:ke vin" OR "mail:ke vin"');
  });
});

describe("directorySearchUrl", () => {
  const url = directorySearchUrl("choe");

  it("targets Graph v1.0 /users", () => {
    expect(url.startsWith("https://graph.microsoft.com/v1.0/users?")).toBe(true);
  });

  it("sends the search expression url-encoded", () => {
    expect(url).toContain(`$search=${encodeURIComponent(directorySearchExpression("choe"))}`);
  });
});

describe("searchDirectory", () => {
  it("acquires a token for the User.Read.All scope", async () => {
    fetchMock.mockResolvedValue(graphResponse({ value: [] }));
    await searchDirectory("choe");
    expect(tokenMock).toHaveBeenCalledWith(GRAPH_USER_SCOPES);
    expect([...GRAPH_USER_SCOPES]).toEqual(["User.Read.All"]);
  });

  it("sends the ConsistencyLevel: eventual header $search requires", async () => {
    // Not a tuning knob: Graph answers 400 for a $search on a directory object
    // without it, so the picker would be permanently broken.
    fetchMock.mockResolvedValue(graphResponse({ value: [] }));
    await searchDirectory("choe");
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.ConsistencyLevel).toBe("eventual");
    expect(init.headers.Authorization).toBe("Bearer graph-token");
  });

  it("passes the abort signal through, so a superseded search is dropped", async () => {
    fetchMock.mockResolvedValue(graphResponse({ value: [] }));
    const controller = new AbortController();
    await searchDirectory("choe", controller.signal);
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it("maps a Graph user onto the app's snake_case shape", async () => {
    fetchMock.mockResolvedValue(graphResponse({ value: [GRAPH_USER] }));
    expect(await searchDirectory("choe")).toEqual([
      {
        id: "aad-1",
        display_name: "Kevin Choe",
        mail: "senzero@gmail.com",
        user_principal_name: "senzero@gmail.com",
        job_title: "Engineer",
        department: "Operations",
      },
    ]);
  });

  it("labels a nameless directory entry by its mail, then by its id", async () => {
    fetchMock.mockResolvedValue(
      graphResponse({
        value: [
          { ...GRAPH_USER, displayName: "  " },
          {
            id: "aad-2",
            displayName: null,
            mail: null,
            userPrincipalName: null,
            jobTitle: null,
            department: null,
          },
        ],
      }),
    );
    const people = await searchDirectory("choe");
    expect(people.map((p) => p.display_name)).toEqual(["senzero@gmail.com", "aad-2"]);
  });

  it("names the missing consent on a 403, because that is the actionable case", async () => {
    fetchMock.mockResolvedValue(
      graphResponse(
        { error: { code: "Authorization_RequestDenied", message: "Insufficient." } },
        { status: 403 },
      ),
    );
    // A 403 rendered as "403 Forbidden" tells a user nothing they can do; the
    // scope needs an Azure admin's grant, so the message has to say so.
    await expect(searchDirectory("choe")).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining("User.Read.All"),
    });
  });

  it("surfaces Graph's own message for any other failure", async () => {
    fetchMock.mockResolvedValue(
      graphResponse({ error: { message: "Request_ThrottledTemporarily" } }, { status: 429 }),
    );
    const error = await searchDirectory("choe").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GraphError);
    expect((error as GraphError).status).toBe(429);
    expect((error as GraphError).message).toBe("Request_ThrottledTemporarily");
  });

  it("falls back to the status when the error body is not JSON", async () => {
    // A proxy's HTML error page is not worth quoting, but the failure still has
    // to read as a sentence rather than an empty string.
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      json: async () => {
        throw new Error("not json");
      },
    } as unknown as Response);
    await expect(searchDirectory("choe")).rejects.toThrow("502 Bad Gateway");
  });

  it("does not swallow a token failure — it never reaches the network", async () => {
    tokenMock.mockRejectedValue(new Error("not signed in"));
    await expect(searchDirectory("choe")).rejects.toThrow("not signed in");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("personEmail", () => {
  const person = {
    id: "aad-1",
    display_name: "Pat Lee",
    mail: "plee@example.com",
    user_principal_name: "pat.lee@example.com",
    job_title: null,
    department: null,
  };

  it("prefers mail, the address roles are usually granted to", () => {
    expect(personEmail(person)).toBe("plee@example.com");
  });

  it("falls back to the UPN for an account with no mailbox", () => {
    expect(personEmail({ ...person, mail: null })).toBe("pat.lee@example.com");
    expect(personEmail({ ...person, mail: "  " })).toBe("pat.lee@example.com");
  });

  it("is null when the entry has neither", () => {
    expect(personEmail({ ...person, mail: null, user_principal_name: null })).toBeNull();
  });
});
