import { Outlet, useLocation, useNavigate } from "react-router-dom";

import PageHeading from "../components/PageHeading";
import TabBar, { type TabItem } from "../components/TabBar";

// One tab per sample, each a nested route under /samples (see routes.tsx). Items
// comes first and is where /samples lands, since it's the one every app keeps.
// Keep one tab per line: /syn-init-webapp's remove-sources.sh deletes the line
// of each optional source an app didn't pick.
const SAMPLE_TABS: TabItem<string>[] = [
  { value: "items", label: "Items" },
  { value: "reports", label: "Reports" },
];

/** Worked examples, one per data source, each under its own tab. */
export default function SamplesPage() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const selected = SAMPLE_TABS.find((t) => pathname.endsWith(`/samples/${t.value}`))?.value ?? null;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeading title="Samples" className="mb-4" />
      <TabBar
        tabs={SAMPLE_TABS}
        value={selected}
        onSelect={(tab) => navigate(`/samples/${tab}`)}
        ariaLabel="Samples"
        className="mb-6 border-b border-slate-300"
      />
      <Outlet />
    </div>
  );
}
