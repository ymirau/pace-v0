import type { ReactNode } from "react";

import Popover, { usePopover, type PopoverProps } from "./Popover";

/**
 * Action menus (⋮ row menus, account menus, "View as"): a `Popover` with menu
 * roles, the house panel style and item rows. Write the items as children:
 *
 *   <Menu trigger={(props) => <button type="button" aria-label="Actions" {...props}><KebabIcon /></button>}>
 *     <MenuItem onSelect={edit}>Edit</MenuItem>
 *     <MenuDivider />
 *     <MenuItem tone="danger" onSelect={remove}>Delete</MenuItem>
 *   </Menu>
 *
 * Picking an item closes the menu (and any menu it's nested in) before its
 * `onSelect` runs; `keepOpen` opts out, for a toggle that changes in place.
 * Placement, dismissal, focus and nesting all come from `Popover`.
 */

const PANEL = "rounded-md border border-slate-200 bg-surface py-1 shadow-lg";

const ITEM =
  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors";
const TONE = {
  default: "text-slate-600 hover:bg-slate-50",
  danger: "text-red-600 hover:bg-red-50",
} as const;

export interface MenuProps {
  trigger: PopoverProps["trigger"];
  children: ReactNode;
  /** Preferred side; flipped/shifted when it doesn't fit. */
  placement?: PopoverProps["placement"];
  /** Tailwind min-width class for the panel. */
  minWidthClass?: string;
  /** Extra panel classes (e.g. a max-width). */
  className?: string;
}

export default function Menu({
  trigger,
  children,
  placement = "bottom-end",
  minWidthClass = "min-w-[170px]",
  className = "",
}: MenuProps) {
  return (
    <Popover
      trigger={trigger}
      role="menu"
      placement={placement}
      className={`${minWidthClass} ${PANEL} ${className}`}
      initialFocusSelector='[role^="menuitem"]'
    >
      {children}
    </Popover>
  );
}

export function MenuItem({
  onSelect,
  icon,
  tone = "default",
  keepOpen = false,
  children,
}: {
  onSelect: () => void;
  icon?: ReactNode;
  tone?: keyof typeof TONE;
  /** Leave the menu open after the pick (e.g. the theme toggle). */
  keepOpen?: boolean;
  children: ReactNode;
}) {
  const { closeAll } = usePopover();
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        if (!keepOpen) closeAll();
        onSelect();
      }}
      className={`${ITEM} ${TONE[tone]}`}
    >
      {icon}
      {children}
    </button>
  );
}

/** One choice of a set (e.g. a role); shows a check mark when `checked`. */
export function MenuRadioItem({
  checked,
  onSelect,
  children,
}: {
  checked: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  const { closeAll } = usePopover();
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      onClick={() => {
        closeAll();
        onSelect();
      }}
      className={`${ITEM} justify-between ${
        checked ? "bg-slate-50 font-medium text-slate-900" : TONE.default
      }`}
    >
      {children}
      {checked && (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="h-3.5 w-3.5"
          aria-hidden="true"
        >
          <path d="M20 6L9 17l-5-5" />
        </svg>
      )}
    </button>
  );
}

export function MenuDivider() {
  return <div role="separator" className="my-1 border-t border-slate-200" />;
}

/** A small uppercase heading over a group of items. */
export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
      {children}
    </div>
  );
}

/** The ⋮ glyph for a menu trigger. */
export function KebabIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </svg>
  );
}
