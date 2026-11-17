import { useMsal } from "@azure/msal-react";
import { useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";

import { AUTH_BYPASS, AUTH_BYPASS_REASON } from "../authBypass";
import { ENV_LABEL } from "../env";
import { useNavCollapsed } from "./navCollapse";
import NavRail, { type NavEntry } from "./NavRail";
import PaceLogo from "./PaceLogo";
import ScrollToTopButton from "./ScrollToTopButton";
import SettingsMenu from "./SettingsMenu";
import SignOutDialog from "./SignOutDialog";

// Per-env badge colors (prod shows no badge). Uses the theme's accent tokens.
const ENV_BADGE: Record<NonNullable<typeof ENV_LABEL>, string> = {
  loc: "bg-blue-100 text-blue-700",
  sbx: "bg-emerald-100 text-emerald-700",
  uat: "bg-amber-100 text-amber-700",
};

// Stroke icons (Feather/Lucide style, 1.5 stroke). Add one per page as you build
// out the app; reference it by key in the NAV array below.
const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  className: "h-4 w-4 shrink-0",
};

const ICONS: Record<string, ReactNode> = {
  home: (
    <svg {...iconProps}>
      <path d="M3 10.5L12 3l9 7.5" />
      <path d="M5 9v12h14V9" />
    </svg>
  ),
  // 2x2 grid - the Samples page (one tab per data source).
  samples: (
    <svg {...iconProps}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  // Life ring - a support/help glyph.
  support: (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
      <path d="M6 6l4 4" />
      <path d="M18 6l-4 4" />
      <path d="M6 18l4-4" />
      <path d="M18 18l-4-4" />
    </svg>
  ),
  // Shield - the admin-only Admin page.
  admin: (
    <svg {...iconProps}>
      <path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  ),
};

// Pace is one screen. The nav rail stays for the header/settings chrome.
// `/log` is each visitor's OWN log, which is why it can live in the app's nav behind the
// shared reviewer code. The view across every visitor is /viewer — not listed here, and
// behind a separate code, because reviewers share one access code and that log holds all
// of their transcripts. See pages/LogPage.tsx and pages/ViewerPage.tsx.
const NAV: NavEntry[] = [
  { to: "/", label: "Pace", icon: "home", end: true },
  { to: "/log", label: "Your log", icon: "samples", end: false },
];

export default function Layout() {
  const { instance, accounts } = useMsal();
  const account = accounts[0];
  const mainRef = useRef<HTMLElement>(null);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [collapsed, setCollapsed] = useNavCollapsed();
  const onSignOut = AUTH_BYPASS ? undefined : () => setSignOutOpen(true);
  const nav = NAV;

  const envBadge = ENV_LABEL && (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${ENV_BADGE[ENV_LABEL]}`}
    >
      {ENV_LABEL}
    </span>
  );

  // Two navs switched by width: the full sidebar at lg+ and the icon rail below
  // it (there's no phone layout). The ⋮ menu's Collapse sidebar switches to the
  // rail at lg+ too, and the rail's » button switches back; the choice is
  // remembered (navCollapse.ts).
  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 text-slate-800">
      <NavRail
        items={nav}
        icons={ICONS}
        envBadge={envBadge}
        account={{
          name: account?.name ?? account?.username ?? "Signed in",
          bypassed: AUTH_BYPASS,
          // Its View as menu nests inside the account menu and places itself.
        }}
        onSignOut={onSignOut}
        onExpand={() => setCollapsed(false)}
        className={collapsed ? "flex" : "flex lg:hidden"}
      />
      <aside
        className={`${collapsed ? "hidden" : "hidden lg:flex"} w-[200px] shrink-0 flex-col border-r border-slate-200 bg-sidebar py-4`}
      >
        <div className="mb-2 px-4 pb-4">
          <div className="mb-2 mt-1.5 flex items-center justify-between gap-2">
            {/* One mark for both themes: PaceLogo draws in currentColor, so there is
                no light/dark pair of images to keep in step. */}
            <PaceLogo className="text-slate-900" />
            {envBadge}
          </div>
          {/* Truncated so a long project name stays on one line; hover shows it all. */}
          <div
            className="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500"
            title="pace-v0"
          >
            pace-v0
          </div>
        </div>
        <nav className="flex flex-1 flex-col">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-2 px-4 py-2 text-[13px] transition-colors ${
                  isActive
                    ? "bg-slate-50 font-medium text-slate-900"
                    : "text-slate-600 hover:bg-slate-50"
                }`
              }
            >
              {ICONS[item.icon]}
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-2 px-4 pt-4 text-[11px] text-slate-500">
          {AUTH_BYPASS ? (
            <div className="min-w-0 italic">
              {AUTH_BYPASS_REASON} — auth bypassed
            </div>
          ) : (
            <div className="min-w-0 truncate" title={account?.username}>
              {account?.name ?? account?.username ?? "Signed in"}
            </div>
          )}
          <div className="ml-auto">
            {/* Collapse, theme toggle, Sign out and the build stamp live in the ⋮ menu. */}
            <SettingsMenu
              onSignOut={onSignOut}
              onCollapse={() => setCollapsed(true)}
            />
          </div>
        </div>
      </aside>
      {/* A column so the View as banner sits flush above <main> and stays put
          while the page scrolls. */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <main ref={mainRef} className="flex-1 overflow-y-auto p-6 pt-4">
          <Outlet />
        </main>
      </div>
      <ScrollToTopButton targetRef={mainRef} />
      <SignOutDialog
        open={signOutOpen}
        onCancel={() => setSignOutOpen(false)}
        onConfirm={() => {
          setSignOutOpen(false);
          instance.logoutRedirect();
        }}
      />
    </div>
  );
}
