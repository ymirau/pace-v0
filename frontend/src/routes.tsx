import { createBrowserRouter } from "react-router-dom";

import AccessGate from "./components/AccessGate";
import AuthGate from "./components/AuthGate";
import Layout from "./components/Layout";
import ChatPage from "./pages/ChatPage";
import LogPage from "./pages/LogPage";

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
      // Two screens: the conversation, and the evidence it produced.
      children: [
        { index: true, element: <ChatPage /> },
        { path: "log", element: <LogPage /> },
      ],
    },
  ],
  // Resolve routes under the per-env deploy base ("/pace-sbx", etc.).
  { basename: import.meta.env.BASE_URL.replace(/\/$/, "") || "/" },
);
