import { Navigate, createBrowserRouter } from "react-router-dom";

import AuthGate from "./components/AuthGate";
import Layout from "./components/Layout";
import ItemsTab from "./components/samples/ItemsTab";
import ReportsTab from "./components/samples/ReportsTab";
import AdminPage from "./pages/AdminPage";
import HomePage from "./pages/HomePage";
import SamplesPage from "./pages/SamplesPage";
import SupportPage from "./pages/SupportPage";

export const router = createBrowserRouter(
  [
    {
      path: "/",
      element: (
        <AuthGate>
          <Layout />
        </AuthGate>
      ),
      // Add one entry per page. The index route is the landing screen.
      children: [
        { index: true, element: <HomePage /> },
        {
          // One nested route per tab (pages/SamplesPage.tsx's SAMPLE_TABS).
          path: "samples",
          element: <SamplesPage />,
          children: [
            { index: true, element: <Navigate to="items" replace /> },
            { path: "items", element: <ItemsTab /> },
            { path: "reports", element: <ReportsTab /> },
          ],
        },
        { path: "support", element: <SupportPage /> },
        { path: "admin", element: <AdminPage /> },
      ],
    },
  ],
  // Resolve routes under the per-env deploy base ("/pace-sbx", etc.).
  // Strip the trailing slash so the basename matches the URL both with and
  // without it. Login no longer returns here directly — MSAL redirects to the
  // shared /auth-callback/ page, which then bounces the browser back to the
  // originating app URL (see authConfig.ts). Local dev (BASE_URL "/") collapses
  // back to "/" via the `|| "/"` fallback.
  { basename: import.meta.env.BASE_URL.replace(/\/$/, "") || "/" },
);
