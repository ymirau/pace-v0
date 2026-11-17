import { Navigate, createBrowserRouter } from "react-router-dom";

import AccessGate from "./components/AccessGate";
import AuthGate from "./components/AuthGate";
import Layout from "./components/Layout";
import ViewerGate from "./components/ViewerGate";
import ChatPage from "./pages/ChatPage";
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
      // The app is one screen: the conversation. The evidence it produces is read from
      // /viewer, which is deliberately not in here.
      children: [{ index: true, element: <ChatPage /> }],
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
