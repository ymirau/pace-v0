import { useState, type ReactNode } from "react";

import { BUILD_STAMP, ENV_LABEL } from "../env";
import Avatar from "./Avatar";
import Menu, { KebabIcon, MenuDivider, MenuItem } from "./Menu";
import { getTheme, toggleTheme, type Theme } from "../theme";

// Sidebar "⋮" (kebab) settings menu at the end of the footer. Opens a small
// popup holding Collapse sidebar, the dark-mode toggle, Sign out, and
// the env + build stamp. Add future account/app settings here.
const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  className: "h-4 w-4 shrink-0",
};

// Sun/moon glyphs; the shown icon is the *target* theme (a moon in light mode to
// switch TO dark, a sun in dark mode to switch TO light).
const THEME_ICONS: Record<Theme, ReactNode> = {
  light: (
    <svg {...iconProps}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  ),
  dark: (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  ),
};

/** The "Dark mode" / "Light mode" row. The active theme lives on <html>, not
 *  React; track it locally and re-sync on each click so the icon/label stay in
 *  step. Clicking toggles in place, so the menu stays open and shows the change. */
function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const target: Theme = theme === "dark" ? "light" : "dark";

  return (
    <MenuItem keepOpen icon={THEME_ICONS[theme]} onSelect={() => setThemeState(toggleTheme())}>
      {target === "dark" ? "Dark mode" : "Light mode"}
    </MenuItem>
  );
}

/**
 * `onSignOut` is omitted under auth bypass (local dev): there is no session, so
 * signing out of nothing would fail. It closes the menu and hands off to the
 * caller, which owns the "Sign out?" dialog — the dialog must live outside this
 * menu, or the menu's outside-click close would take it down with it.
 *
 * `account` swaps the ⋮ trigger for the user's Avatar and heads the menu with
 * their name: the collapsed nav rail (NavRail) has no room to show it otherwise.
 * `bypassed` (local dev) shows the auth-bypass notice in place of a name.
 *
 * `badge` (the RoleBadge, admins only) sits beside that name; its own "View as"
 * menu nests inside this one (see Popover).
 *
 * `onCollapse` adds the Collapse sidebar item (the full sidebar's menu only; the
 * rail expands back with its own » button, one click from the default).
 *
 * Placement is only a preference (up, extending right, from the sidebar footer):
 * Menu flips it when the room is on the other side.
 */
export default function SettingsMenu({
  onSignOut,
  account,
  onCollapse,
}: {
  onSignOut?: () => void;
  account?: { name: string; bypassed: boolean; badge?: ReactNode };
  onCollapse?: () => void;
}) {
  const label = account ? "Account and settings" : "Settings";

  return (
    <Menu
      placement="top-start"
      trigger={(props) => (
        <button
          type="button"
          {...props}
          aria-label={label}
          title={label}
          className={
            account
              ? "flex shrink-0 rounded-full"
              : "shrink-0 rounded p-1 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800"
          }
        >
          {account ? (
            <Avatar name={account.bypassed ? "Local Dev" : account.name} />
          ) : (
            <KebabIcon />
          )}
        </button>
      )}
    >
      {account && (
        <div className="mb-1 flex max-w-[240px] items-center gap-1.5 border-b border-slate-200 px-3 pt-1 pb-2 text-[12px]">
          <span
            className={`min-w-0 truncate ${account.bypassed ? "italic text-slate-600" : "text-slate-900"}`}
            title={account.bypassed ? undefined : account.name}
          >
            {account.bypassed ? "Local dev — auth bypassed" : account.name}
          </span>
          {account.badge}
        </div>
      )}
      {onCollapse && (
        <MenuItem
          onSelect={onCollapse}
          icon={
            <svg {...iconProps}>
              <path d="M18 17l-5-5 5-5" />
              <path d="M11 17l-5-5 5-5" />
            </svg>
          }
        >
          Collapse sidebar
        </MenuItem>
      )}
      <ThemeToggle />
      {onSignOut && (
        <>
          <MenuDivider />
          <MenuItem
            onSelect={onSignOut}
            icon={
              <svg {...iconProps}>
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <path d="M16 17l5-5-5-5" />
                <path d="M21 12H9" />
              </svg>
            }
          >
            Sign out
          </MenuItem>
        </>
      )}
      {/* Env + build stamp (yyyymmdd.hhmmss from vite.config.ts): all envs share
          one origin and differ only by path, so this is how a support call tells
          which build it is looking at. Selectable so it can be copied. */}
      <div className="mt-1 border-t border-slate-200 px-3 pt-2 pb-1 font-mono text-[10px] tabular-nums text-slate-400">
        {ENV_LABEL ?? "prod"} · {BUILD_STAMP}
      </div>
    </Menu>
  );
}
