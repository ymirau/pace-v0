import { createBrowserRouter } from "react-router-dom";

import AuthGate from "./components/AuthGate";
import Layout from "./components/Layout";
import ChatPage from "./pages/ChatPage";

export const router = createBrowserRouter(
  [
    {
      path: "/",
      element: (
        <AuthGate>
          <Layout />
        </AuthGate>
      ),
      // Pace is one screen: the conversation. Anything else would be the clicking
      // this product exists to remove.
      children: [{ index: true, element: <ChatPage /> }],
    },
  ],
  // Resolve routes under the per-env deploy base ("/pace-sbx", etc.).
  { basename: import.meta.env.BASE_URL.replace(/\/$/, "") || "/" },
);
