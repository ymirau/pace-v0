import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError } from "../../api/client";
import {
  useCreateUserRole,
  useDeleteUserRole,
  useUpdateUserRole,
  useUserRoles,
  type UserRole,
} from "../../api/userRoles";
import type { Role } from "../../lib/role";
import ModalForm, { SelectField, TextInput, btnPrimaryClass } from "../ModalForm";
import PeoplePicker, { type PersonSelection } from "../PeoplePicker";

const BTN_ICON =
  "inline-flex items-center justify-center rounded-md border border-slate-300 bg-surface p-1.5 text-slate-700 hover:bg-slate-50 disabled:opacity-50";

const ROLE_LABEL: Record<Role, string> = { admin: "Admin", user: "User" };

/** The server's own words for a refusal (409 guards, 422, 404), else the error's. */
function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.detail;
  return error instanceof Error ? error.message : String(error);
}

function PencilIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

/** The name a row shows: the directory display name, else the email. */
function displayName(row: UserRole): string {
  return row.display_name?.trim() || row.email;
}

/**
 * Add (a person from the directory + role) or edit (role only; Remove in the
 * footer) one row. Add is directory-only: under the local auth bypass there is
 * no Azure session to search with, so admins are added there with SQL.
 */
function UserRoleFormModal({ editing, onClose }: { editing: UserRole | null; onClose: () => void }) {
  const create = useCreateUserRole();
  const update = useUpdateUserRole();
  const remove = useDeleteUserRole();
  const [person, setPerson] = useState<PersonSelection | null>(null);
  const [role, setRole] = useState<Role>(editing?.role ?? "admin");
  const [formError, setFormError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const onError = (err: unknown) => {
    setFormError(errorMessage(err));
    // Someone else removed it meanwhile: refresh the list behind the modal.
    if (err instanceof ApiError && err.status === 404) {
      void queryClient.invalidateQueries({ queryKey: ["user-roles"] });
    }
  };

  const handleSubmit = () => {
    if (editing) update.mutate({ id: editing.id, role }, { onSuccess: onClose, onError });
    else if (person)
      create.mutate(
        { email: person.email, role, display_name: person.name },
        { onSuccess: onClose, onError },
      );
  };

  const handleDelete = () => {
    if (!editing) return;
    if (!window.confirm(`Remove ${displayName(editing)}'s role? They'll be a plain user.`)) return;
    remove.mutate(editing.id, { onSuccess: onClose, onError });
  };

  return (
    <ModalForm
      title={editing ? "Edit role" : "Add a role"}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitLabel={editing ? "Save changes" : "Add"}
      submitting={create.isPending || update.isPending}
      submitDisabled={!editing && !person}
      error={formError}
      onDelete={editing ? handleDelete : undefined}
      deleteLabel="Remove"
      deleting={remove.isPending}
    >
      {editing ? (
        <>
          {editing.display_name && <TextInput label="Name" value={editing.display_name} disabled />}
          <TextInput label="Email" type="email" value={editing.email} disabled />
        </>
      ) : (
        <PeoplePicker
          label="Person"
          required
          value={person}
          onSelect={(selection) => {
            setPerson(selection);
            setFormError(null);
          }}
          onClear={() => setPerson(null)}
        />
      )}
      <SelectField label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
        <option value="admin">Admin</option>
        <option value="user">User</option>
      </SelectField>
    </ModalForm>
  );
}

/**
 * The Admin page's Users tab: who has a role. Built like the Items page (table,
 * "+ Add" modal, pencil to edit, Remove inside the edit modal). Anyone without a
 * row is a plain user, so this list is normally just the admins. The API refuses
 * changing your own row and removing the last admin; its reason shows in the modal.
 */
export default function UsersSection() {
  const { data: rows, isLoading, isError, error } = useUserRoles();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<UserRole | null>(null);

  const openModal = (row: UserRole | null) => {
    setEditing(row);
    setOpen(true);
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-sm text-slate-600">
          People with a role. Everyone else who signs in is a plain user.
        </p>
        <button type="button" className={btnPrimaryClass} onClick={() => openModal(null)}>
          + Add
        </button>
      </div>

      {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {isError && <p className="text-sm text-red-600">Failed to load roles: {errorMessage(error)}</p>}

      {rows && (
        <table className="w-full overflow-hidden rounded-lg border border-slate-200 bg-surface text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium">Updated</th>
              <th className="px-4 py-2 font-medium" aria-label="Actions" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-2 font-medium text-slate-900" title={row.email}>
                  {displayName(row)}
                </td>
                <td className="px-4 py-2 text-slate-600">{ROLE_LABEL[row.role]}</td>
                <td className="px-4 py-2 text-slate-600">
                  {new Date(row.updated_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-2">
                  <div className="flex justify-end">
                    <button
                      type="button"
                      className={BTN_ICON}
                      aria-label={`Edit ${displayName(row)}`}
                      title="Edit"
                      onClick={() => openModal(row)}
                    >
                      <PencilIcon />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                  No admins yet. Everyone is a user. Apply sql/postgres/004_user_roles.sql to
                  seed the first admin.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {open && <UserRoleFormModal editing={editing} onClose={() => setOpen(false)} />}
    </div>
  );
}
