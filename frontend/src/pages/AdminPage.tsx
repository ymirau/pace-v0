import { useState } from "react";

import { useRole } from "../api/me";
import UsersSection from "../components/admin/UsersSection";
import PageHeading from "../components/PageHeading";
import TabBar from "../components/TabBar";

// One tab per admin section. Add more here (e.g. app settings) as the app grows.
const TABS = [{ value: "users", label: "Users" }] as const;
type Tab = (typeof TABS)[number]["value"];

/**
 * The Admin page - `/admin`, admins only. The nav hides it from everyone else
 * (lib/role.ts's visibleNav); someone who opens the URL anyway gets a notice here,
 * and the API itself answers 403 (require_role("admin")), which is the real guard.
 */
export default function AdminPage() {
  const { isAdmin } = useRole();
  const [tab, setTab] = useState<Tab>("users");

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeading title="Admin" className="mb-4" />
        <div className="rounded-lg border border-slate-200 bg-surface p-4 text-sm">
          <p className="font-medium text-slate-900">Admins only</p>
          <p className="mt-1 text-slate-600">You need the admin role to see this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeading title="Admin" className="mb-2" />
      <TabBar
        tabs={TABS}
        value={tab}
        onSelect={setTab}
        ariaLabel="Admin sections"
        className="mb-6 border-b border-slate-300"
      />
      {tab === "users" && <UsersSection />}
    </div>
  );
}
