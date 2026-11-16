import type { ReactNode } from "react";

export interface TabItem<V extends string | number> {
  value: V;
  label: ReactNode;
  /** Optional trailing content after the label (e.g. an item count). */
  badge?: ReactNode;
}

/**
 * The app's one tab style: tabs as text links that wrap
 * onto more lines rather than overflow. The selected tab is plain bold dark
 * text, the others blue links; 44px tap floor below lg. Tab semantics
 * (tablist / tab / aria-selected) are kept.
 *
 * Only the tabs themselves: the caller owns the row around them (the bottom
 * border, sticky header, spacing) and what each tab shows, since each page
 * frames it differently. See components/samples/ItemsTab.tsx for a worked
 * example (nested inside pages/SamplesPage.tsx's own tabs).
 */
export default function TabBar<V extends string | number>({
  tabs,
  value,
  onSelect,
  ariaLabel,
  id,
  className = "",
}: {
  tabs: readonly TabItem<V>[];
  /** The selected tab; null selects none. */
  value: V | null;
  onSelect: (value: V) => void;
  ariaLabel: string;
  id?: string;
  className?: string;
}) {
  return (
    <div
      id={id}
      className={`flex flex-wrap gap-x-4 pb-2 ${className}`}
      role="tablist"
      aria-label={ariaLabel}
    >
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(tab.value)}
            className={
              "group inline-flex min-h-[2.75rem] items-center gap-1.5 text-xs lg:min-h-8 " +
              (active
                ? "cursor-default font-semibold text-slate-900"
                : "cursor-pointer text-blue-700")
            }
          >
            {/* The hover underline is on the label alone: on the button it would
                run under the badge too. */}
            <span className={active ? "" : "underline-offset-2 group-hover:underline"}>
              {tab.label}
            </span>
            {tab.badge}
          </button>
        );
      })}
    </div>
  );
}
