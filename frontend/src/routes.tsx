import { Navigate, createBrowserRouter } from "react-router-dom";

import AccessGate from "./components/AccessGate";
import AuthGate from "./components/AuthGate";
import Layout from "./components/Layout";
import ViewerGate from "./components/ViewerGate";
import ChatPage from "./pages/ChatPage";
import LogPage from "./pages/LogPage";
import ViewerPage from "./pages/ViewerPage";

export const router = createBrowserRouter(
  [
    {
      path: "/",
      element: (
        <AuthGate>
          <AccessGate>
            <Layout />
          </AccessGate>
        </AuthGate>
      ),
      // Two screens: the conversation, and your own log of it. `/log` is scoped to the
      // caller's own sessions (see pages/LogPage.tsx); the view across every visitor is
      // /viewer below, behind a different code.
      children: [
        { index: true, element: <ChatPage /> },
        { path: "log", element: <LogPage /> },
      ],
    },
    {
      // The ratings log, outside the app on purpose: its own URL, its own code, and
      // none of the app's shell or nav. See pages/ViewerPage.tsx for why.
      //
      // `AuthGate` still wraps it — invariant 5 in CLAUDE.md is that /api needs a token,
      // and this reads /api/log. `AccessGate` does not: the reviewer code buys a
      // conversation, and `ViewerGate` asks for the separate code that reads the log.
      path: "/viewer",
      element: (
        <AuthGate>
          <ViewerGate>
            <ViewerPage />
          </ViewerGate>
        </AuthGate>
      ),
    },
    {
      // Anything else goes to the chat rather than a blank screen. There was no
      // catch-all before, and `/log` moving to `/viewer` turned an old bookmark into a
      // white page that reads as "the app is broken" rather than "that URL is gone".
      path: "*",
      element: <Navigate to="/" replace />,
    },
  ],
  // Resolve routes under the per-env deploy base ("/pace-sbx", etc.).
  { basename: import.meta.env.BASE_URL.replace(/\/$/, "") || "/" },
);
