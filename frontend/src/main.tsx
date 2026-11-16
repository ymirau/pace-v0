import { EventType } from "@azure/msal-browser";
import type { AuthenticationResult } from "@azure/msal-browser";
import { MsalProvider } from "@azure/msal-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import "./index.css";
import { ApiError } from "./api/client";
import { msalInstance } from "./msalInstance";
import { router } from "./routes";
import { initTheme } from "./theme";

// Re-apply the resolved theme (the index.html bootstrap already painted it) and
// start following the OS preference live while there's no manual override.
initTheme();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A 4xx is an ANSWER, not a blip: retrying a 404 three times with
      // exponential backoff only delays the page's not-found state by several
      // seconds, and a 403 will be refused just as firmly the fourth time.
      // Everything else keeps TanStack's default three attempts.
      retry: (failureCount, error) =>
        !(error instanceof ApiError && error.status >= 400 && error.status < 500) &&
        failureCount < 3,
    },
  },
});

// MSAL v3+ requires initialize() to resolve before the instance is used.
await msalInstance.initialize();

// Set the active account after a redirect login, and keep it in sync on login.
const accounts = msalInstance.getAllAccounts();
if (accounts.length > 0) {
  msalInstance.setActiveAccount(accounts[0]);
}
msalInstance.addEventCallback((event) => {
  if (event.eventType === EventType.LOGIN_SUCCESS && event.payload) {
    msalInstance.setActiveAccount((event.payload as AuthenticationResult).account);
  }
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MsalProvider instance={msalInstance}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MsalProvider>
  </StrictMode>,
);
