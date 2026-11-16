import { useRole } from "../api/me";
import { previewableRoles, ROLE_LABEL, ROLE_PILL_CLASS } from "../lib/role";
import Menu, { MenuLabel, MenuRadioItem } from "./Menu";

/**
 * The account-area role badge, and for an admin the "View as" control: the pill shows the EFFECTIVE role, so the thing you
 * change and the thing that confirms the change are one element. Clicking it
 * opens a menu of roles; picking your real role ends the preview. Only real
 * admins get it; everyone else, and anyone while /api/me loads, sees nothing.
 * The backend still checks the real role on every request.
 *
 * The menu places itself (Menu/Popover): up from the sidebar footer, and inside
 * the rail's account menu it nests, so picking a role closes both.
 */
export default function RoleBadge() {
  const { realRole, isRealAdmin, role, setViewAsRole } = useRole();

  if (!isRealAdmin) return null;

  return (
    <Menu
      placement="top-end"
      minWidthClass="min-w-[128px]"
      trigger={(props) => (
        <button
          type="button"
          {...props}
          title="View as…"
          className={`flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-opacity hover:opacity-80 ${ROLE_PILL_CLASS[role]}`}
        >
          {ROLE_LABEL[role]}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            className="h-2.5 w-2.5"
            aria-hidden="true"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      )}
    >
      <MenuLabel>View as</MenuLabel>
      {previewableRoles(realRole).map((r) => (
        <MenuRadioItem
          key={r}
          checked={role === r}
          // Your real role is "no preview".
          onSelect={() => setViewAsRole(r === realRole ? null : r)}
        >
          {ROLE_LABEL[r]}
        </MenuRadioItem>
      ))}
    </Menu>
  );
}
