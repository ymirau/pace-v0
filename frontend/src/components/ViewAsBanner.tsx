import { useRole } from "../api/me";
import { ROLE_LABEL } from "../lib/role";

/**
 * The bar across the top of the content while an admin previews another role
 * ("View as", from RoleBadge): it makes the preview unmistakable and ends it in
 * one click. Layout renders it above <main>, so it stays put while the page
 * scrolls. Nothing when not previewing.
 *
 * Only the amber-100 / amber-700 pair, the two shades index.css re-tunes for dark
 * mode; the Exit button inherits amber-700, so it reads in both themes.
 */
export default function ViewAsBanner() {
  const { previewing, setViewAsRole } = useRole();
  if (!previewing) return null;

  return (
    <div className="flex items-center justify-center gap-3 border-b border-amber-700/25 bg-amber-100 px-4 py-2 text-[13px] text-amber-700">
      <span>
        Viewing as <span className="font-semibold">{ROLE_LABEL[previewing]}</span> - preview
        only, your access is unchanged.
      </span>
      <button
        type="button"
        onClick={() => setViewAsRole(null)}
        className="min-h-[2.75rem] shrink-0 rounded border border-amber-700/40 px-3 py-0.5 font-medium transition-colors hover:bg-amber-700/10 lg:min-h-0 lg:px-2"
      >
        Exit
      </button>
    </div>
  );
}
