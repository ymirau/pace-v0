import { PublicClientApplication } from "@azure/msal-browser";

import { msalConfig } from "./authConfig";

/**
 * Single MSAL instance shared by the React tree (MsalProvider) and the
 * non-component API client. `initialize()` must complete before first use
 * (awaited in main.tsx before render — an MSAL v3+ requirement).
 */
export const msalInstance = new PublicClientApplication(msalConfig);
