// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocked before any import of it: client.ts reaches msalInstance/authBypass,
// which want a real browser. Only the token is stubbed: the real
// useDirectorySearch, search-expression builder and error mapping all run, so
// `fetch.mock.calls` is the request the SPA would genuinely send to Graph.
vi.mock("../api/client", () => ({
  apiFetch: vi.fn(),
  apiUpload: vi.fn(),
  acquireTokenSilently: vi.fn(),
}));

import { acquireTokenSilently } from "../api/client";
import { directorySearchExpression } from "../api/graph";
import PeoplePicker, { type PersonSelection } from "./PeoplePicker";

const tokenMock = vi.mocked(acquireTokenSilently);
const fetchMock = vi.fn();

const GRAPH_USER = {
  id: "aad-1",
  displayName: "Kevin Choe",
  mail: "senzero@gmail.com",
  userPrincipalName: "senzero@gmail.com",
  jobTitle: "Engineer",
  department: "Operations",
};

function graphOk(value: unknown[]) {
  return { ok: true, status: 200, statusText: "OK", json: async () => ({ value }) } as Response;
}

function graphFail(status: number, message: string) {
  return {
    ok: false,
    status,
    statusText: "Error",
    json: async () => ({ error: { message } }),
  } as Response;
}

/** A client per test: shared cache state would serve a previous test's rows. */
function renderPicker(props: Partial<Parameters<typeof PeoplePicker>[0]> = {}) {
  const onSelect = vi.fn();
  const onClear = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  // debounceMs 0: the timer itself is covered by hooks/useDebounced.test.ts.
  render(<PeoplePicker onSelect={onSelect} onClear={onClear} debounceMs={0} {...props} />, {
    wrapper,
  });
  return { onSelect, onClear };
}

const searchBox = () => screen.getByLabelText(/Person/);
const type = (value: string) => fireEvent.change(searchBox(), { target: { value } });
const lastUrl = () => fetchMock.mock.calls.at(-1)?.[0] as string | undefined;

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(graphOk([]));
  tokenMock.mockReset();
  tokenMock.mockResolvedValue("graph-token");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the minimum term", () => {
  it("asks nothing of Graph until two characters are typed", async () => {
    renderPicker();
    type("k");
    await waitFor(() => expect(screen.getByText(/Keep typing/)).toBeTruthy());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("searches as soon as the minimum is reached", async () => {
    renderPicker();
    type("ke");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(lastUrl()).toContain(encodeURIComponent(directorySearchExpression("ke")));
  });
});

describe("the results", () => {
  it("lists each match with the line that disambiguates it", async () => {
    fetchMock.mockResolvedValue(graphOk([GRAPH_USER]));
    renderPicker();
    type("choe");

    const row = await screen.findByRole("button", { name: /Kevin Choe/ });
    expect(row.textContent).toContain("senzero@gmail.com · Engineer · Operations");
  });

  it("yields the email and display name, never the typed text", async () => {
    fetchMock.mockResolvedValue(graphOk([GRAPH_USER]));
    const { onSelect } = renderPicker();
    type("choe");

    fireEvent.click(await screen.findByRole("button", { name: /Kevin Choe/ }));
    const expected: PersonSelection = { name: "Kevin Choe", email: "senzero@gmail.com" };
    expect(onSelect).toHaveBeenCalledWith(expected);
  });

  it("uses the UPN when the person has no mailbox", async () => {
    fetchMock.mockResolvedValue(
      graphOk([{ ...GRAPH_USER, mail: null, userPrincipalName: "kevin.choe@example.com" }]),
    );
    const { onSelect } = renderPicker();
    type("choe");

    fireEvent.click(await screen.findByRole("button", { name: /Kevin Choe/ }));
    expect(onSelect).toHaveBeenCalledWith({ name: "Kevin Choe", email: "kevin.choe@example.com" });
  });

  it("explains an empty result", async () => {
    renderPicker();
    type("zzzz");
    expect(await screen.findByText(/No one in the directory matches/)).toBeTruthy();
  });

  it("tells the admin what to type, as the search box's placeholder", () => {
    renderPicker();
    expect(searchBox().getAttribute("placeholder")).toBe("Search company directory...");
  });
});

describe("the failure path", () => {
  it("renders Graph's refusal rather than an empty list", async () => {
    fetchMock.mockResolvedValue(graphFail(403, "Insufficient privileges."));
    renderPicker();
    type("choe");

    const message = await screen.findByText(/Directory search unavailable/);
    expect(message.textContent).toContain("User.Read.All");
    expect(screen.queryByText(/No one in the directory matches/)).toBeNull();
    expect(screen.queryByRole("list", { name: "Directory" })).toBeNull();
  });

  it("reports a token that could not be acquired, without touching the network", async () => {
    tokenMock.mockRejectedValue(new Error("you are not signed in to Azure on this page."));
    renderPicker();
    type("choe");

    expect(await screen.findByText(/not signed in to Azure/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the chosen person", () => {
  const value: PersonSelection = { name: "Kevin Choe", email: "senzero@gmail.com" };

  it("shows the name and email instead of the search box", () => {
    renderPicker({ value });
    expect(screen.getByText("Kevin Choe")).toBeTruthy();
    expect(screen.getByText("senzero@gmail.com")).toBeTruthy();
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("can be cleared to search again", () => {
    const { onClear } = renderPicker({ value });
    fireEvent.click(screen.getByRole("button", { name: "Choose someone else" }));
    expect(onClear).toHaveBeenCalled();
  });
});
