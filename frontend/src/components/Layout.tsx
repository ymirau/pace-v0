import { useMsal } from "@azure/msal-react";
import { useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";

import { AUTH_BYPASS } from "../authBypass";
import { ENV_LABEL } from "../env";
import logo from "../assets/logo.png";
import logoDark from "../assets/logo_dark.png";
import { useRole } from "../api/me";
import { visibleNav } from "../lib/role";
import { useNavCollapsed } from "./navCollapse";
import NavRail, { type NavEntry } from "./NavRail";
import RoleBadge from "./RoleBadge";
import ScrollToTopButton from "./ScrollToTopButton";
import SettingsMenu from "./SettingsMenu";
import SignOutDialog from "./SignOutDialog";
import ViewAsBanner from "./ViewAsBanner";

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

// One entry per page. Keep in sync with the routes in routes.tsx. `adminOnly`
// entries show only to admins and always come LAST (lib/role.ts's visibleNav), so
// add new pages anywhere above Admin.
const NAV: NavEntry[] = [
  { to: "/", label: "Home", icon: "home", end: true },
  { to: "/samples", label: "Samples", icon: "samples", end: false },
  { to: "/support", label: "Support", icon: "support", end: false },
  { to: "/admin", label: "Admin", icon: "admin", end: false, adminOnly: true },
];

export default function Layout() {
  const { instance, accounts } = useMsal();
  const account = accounts[0];
  const mainRef = useRef<HTMLElement>(null);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [collapsed, setCollapsed] = useNavCollapsed();
  const onSignOut = AUTH_BYPASS ? undefined : () => setSignOutOpen(true);
  const { isAdmin } = useRole();
  const nav = visibleNav(NAV, isAdmin);

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
          badge: <RoleBadge />,
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
            {/* The logo's navy lettering vanishes on the dark sidebar, so dark mode
                swaps in a copy with the lettering recoloured to the dark theme's ink
                (#e7e1d6); the swoosh and mountain are unchanged. */}
            <img src={logo} alt="Synveon" className="h-8 w-auto dark:hidden" />
            <img src={logoDark} alt="Synveon" className="hidden h-8 w-auto dark:block" />
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
            <div className="min-w-0 italic">Local dev — auth bypassed</div>
          ) : (
            <div className="min-w-0 truncate" title={account?.username}>
              {account?.name ?? account?.username ?? "Signed in"}
            </div>
          )}
          {/* Admins only: the role pill, which is also the "View as" control. */}
          <RoleBadge />
          <div className="ml-auto">
            {/* Collapse, theme toggle, Sign out and the build stamp live in the ⋮ menu. */}
            <SettingsMenu onSignOut={onSignOut} onCollapse={() => setCollapsed(true)} />
          </div>
        </div>
      </aside>
      {/* A column so the View as banner sits flush above <main> and stays put
          while the page scrolls. */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <ViewAsBanner />
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
