import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

import SettingsMenu from "./SettingsMenu";

export interface NavEntry {
  to: string;
  label: string;
  icon: string;
  end: boolean;
  /** Shown only to admins (Layout filters with lib/role.ts's visibleNav). */
  adminOnly?: boolean;
}

/**
 * The collapsed nav: a 64px icon-only rail,
 * so the page keeps most of the width. Layout shows it at every width below lg,
 * and at lg+ when the user collapses the sidebar. The destinations come from
 * Layout's NAV / ICONS, so the rail and the full sidebar can't drift apart.
 *
 * Icon-only, so every item carries an aria-label and a native tooltip; without
 * them the rail is unusable with a screen reader and guesswork with a mouse.
 */
export default function NavRail({
  items,
  icons,
  envBadge,
  account,
  onSignOut,
  onExpand,
  className = "",
}: {
  items: readonly NavEntry[];
  icons: Record<string, ReactNode>;
  /** The env badge (loc/sbx/uat), or null in prod. */
  envBadge: ReactNode;
  account: { name: string; bypassed: boolean; badge?: ReactNode };
  onSignOut?: () => void;
  /** Back to the full sidebar. Only offered at lg+, where there's room for it. */
  onExpand: () => void;
  /** Visibility classes from Layout (e.g. "flex lg:hidden"). */
  className?: string;
}) {
  // Only the <nav> scrolls, the one part that can actually grow; the env badge
  // and the account avatar stay pinned top and bottom. (The account menu renders
  // in a portal (Popover), so no scroll container here can clip it.)
  return (
    <aside
      className={`w-16 shrink-0 flex-col items-center border-r border-slate-200 bg-sidebar py-3 ${className}`}
    >
      {/* No logo: at rail width it's too small to read; the env badge leads. */}
      {envBadge && <div className="mb-3">{envBadge}</div>}

      {/* min-h-0 lets this flex child shrink below its content height so the
          overflow-y-auto actually engages on a short window. */}
      <nav
        aria-label="Main"
        className="flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto"
      >
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            aria-label={item.label}
            title={item.label}
            className={({ isActive }) =>
              // The glyph is the whole control here, so it's drawn a size up.
              `flex h-10 w-10 shrink-0 items-center justify-center rounded-md transition-colors [&>svg]:h-5 [&>svg]:w-5 ${
                isActive
                  ? "bg-slate-50 text-slate-900"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`
            }
          >
            {icons[item.icon]}
          </NavLink>
        ))}
      </nav>

      <div className="mt-3 flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={onExpand}
          aria-label="Expand sidebar"
          title="Expand sidebar"
          className="hidden h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800 lg:flex"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            className="h-4 w-4"
          >
            <path d="M6 17l5-5-5-5" />
            <path d="M13 17l5-5-5-5" />
          </svg>
        </button>
        <SettingsMenu account={account} onSignOut={onSignOut} />
      </div>
    </aside>
  );
}
