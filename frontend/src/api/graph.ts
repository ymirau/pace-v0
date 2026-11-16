import { useQuery } from "@tanstack/react-query";

import { acquireTokenSilently } from "./client";

/**
 * Directory lookup against **Microsoft Graph**, for the Admin → Users people
 * picker. The SPA uses the shared Synveon Azure app registration, which already has
 * `User.Read.All` consented.
 *
 * This is the one module in `api/` that does not talk to our own backend: the
 * SPA asks Graph directly with the signed-in user's own token. `apiFetch` is not
 * used (it prefixes our API base and injects an `api://…/access_as_user` token,
 * both wrong for graph.microsoft.com).
 *
 * ## The three things Graph's /users search requires
 *
 * 1. **`$search`, not `$filter`.** `startswith(displayName, …)` only matches
 *    from the beginning of the full name, so "choe" would never find
 *    "Kevin Choe". `$search` is tokenised and matches any word.
 * 2. **`ConsistencyLevel: eventual`.** Graph answers **400** without it.
 * 3. **The `User.Read.All` delegated scope**, which needs admin consent.
 *
 * A failure here NEVER degrades to an empty list: "nobody is called that" and
 * "this app cannot search the directory" look identical there, and only the
 * second has a fix.
 */

const GRAPH_USERS_URL = "https://graph.microsoft.com/v1.0/users";

/** Delegated scope for reading other users' directory entries. Admin-consented. */
export const GRAPH_USER_SCOPES = ["User.Read.All"] as const;

/** Shortest term worth a request: one letter matches a large slice of the tenant. */
export const MIN_DIRECTORY_TERM = 2;

/** Type-ahead debounce. Graph is throttled per app per tenant. */
export const DIRECTORY_DEBOUNCE_MS = 300;

/** How many matches to ask for: one screenful; narrowing beats paging here. */
const DIRECTORY_PAGE_SIZE = 15;

/**
 * The Graph `user` fields the picker reads. `userPrincipalName` is here because
 * this app keys roles on the email, and an account with no `mail` still signs in
 * as its UPN.
 */
const DIRECTORY_SELECT = "id,displayName,mail,userPrincipalName,jobTitle,department";

/** A directory user, in this app's snake_case. Mirrors what `$select` asks for. */
export interface DirectoryPerson {
  /** The AAD object id. Not stored; used as the list key. */
  id: string;
  display_name: string;
  mail: string | null;
  user_principal_name: string | null;
  job_title: string | null;
  department: string | null;
}

/** The shape Graph returns from /users. */
interface GraphUsersResponse {
  value?: {
    id: string;
    displayName: string | null;
    mail: string | null;
    userPrincipalName: string | null;
    jobTitle: string | null;
    department: string | null;
  }[];
}

/** Graph's error envelope. */
interface GraphErrorResponse {
  error?: { code?: string; message?: string };
}

/** A non-2xx from Graph, carrying the status as data (same rule as `ApiError`). */
export class GraphError extends Error {
  readonly status: number;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = "GraphError";
    this.status = status;
  }
}

/**
 * The OData `$search` expression. The term goes into a **quoted** OData string,
 * so a `"` or `\` in it would end the literal early (a 400): neutralise them.
 * Both `displayName` and `mail` are searched, since people look each other up by
 * whichever they have to hand.
 */
export function directorySearchExpression(term: string): string {
  const safe = term.replace(/["\\]/g, " ").trim();
  return `"displayName:${safe}" OR "mail:${safe}"`;
}

/** The full request URL, split out so a test can read it without a network. */
export function directorySearchUrl(term: string): string {
  const query = [
    `$search=${encodeURIComponent(directorySearchExpression(term))}`,
    `$select=${encodeURIComponent(DIRECTORY_SELECT)}`,
    `$top=${DIRECTORY_PAGE_SIZE}`,
  ].join("&");
  return `${GRAPH_USERS_URL}?${query}`;
}

/**
 * Turn a failed response into a sentence worth showing. 401/403 (missing
 * consent) names the grant; otherwise Graph's own `error.message` wins.
 */
async function graphErrorDetail(response: Response): Promise<string> {
  let message: string;
  try {
    const body = (await response.json()) as GraphErrorResponse;
    message = body.error?.message?.trim() ?? "";
  } catch {
    // A non-JSON body (a proxy's HTML error page) is not worth reporting.
    message = "";
  }
  if (response.status === 401 || response.status === 403) {
    const hint = `this account is not allowed to search the directory — ${GRAPH_USER_SCOPES.join(
      ", ",
    )} may not be consented.`;
    return message ? `${hint} (${message})` : hint;
  }
  return message || `Microsoft Graph answered ${response.status} ${response.statusText}.`;
}

function toPerson(user: NonNullable<GraphUsersResponse["value"]>[number]): DirectoryPerson {
  return {
    id: user.id,
    // A directory entry with no displayName is possible; fall back so the row
    // stays selectable and labelled instead of rendering a blank button.
    display_name:
      user.displayName?.trim() || user.mail?.trim() || user.userPrincipalName?.trim() || user.id,
    mail: user.mail,
    user_principal_name: user.userPrincipalName,
    job_title: user.jobTitle,
    department: user.department,
  };
}

/**
 * The address a role is granted to: `mail`, else the UPN (what the user signs
 * in as, and so what `/api/me` sees). Null only for an entry with neither.
 */
export function personEmail(person: DirectoryPerson): string | null {
  return person.mail?.trim() || person.user_principal_name?.trim() || null;
}

/**
 * People in the tenant matching `term`. Throws `TokenUnavailableError` (no
 * Azure session / no consent) or `GraphError` (a non-2xx); both carry a message
 * the picker renders verbatim.
 */
export async function searchDirectory(
  term: string,
  signal?: AbortSignal,
): Promise<DirectoryPerson[]> {
  const token = await acquireTokenSilently(GRAPH_USER_SCOPES);
  const response = await fetch(directorySearchUrl(term), {
    headers: {
      Authorization: `Bearer ${token}`,
      // Required for $search on directory objects: Graph answers 400 without it.
      ConsistencyLevel: "eventual",
      Accept: "application/json",
    },
    signal,
  });
  if (!response.ok) {
    throw new GraphError(response.status, await graphErrorDetail(response));
  }
  const body = (await response.json()) as GraphUsersResponse;
  return (body.value ?? []).map(toPerson);
}

export const directoryKeys = {
  all: ["directory"] as const,
  search: (term: string) => [...directoryKeys.all, "users", term] as const,
};

/**
 * Search the directory, or stay idle below the minimum term (the rule lives in
 * `enabled`, so no caller can forget it). `retry: false`: an unconsented scope
 * is a permanent answer. Generous `staleTime`: the directory changes on the
 * timescale of a hiring cycle.
 */
export function useDirectorySearch(term: string, enabled = true) {
  return useQuery({
    queryKey: directoryKeys.search(term),
    queryFn: ({ signal }) => searchDirectory(term, signal),
    enabled: enabled && term.length >= MIN_DIRECTORY_TERM,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}
