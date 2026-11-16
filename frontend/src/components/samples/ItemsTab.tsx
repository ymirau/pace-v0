import { useState } from "react";

import Menu, { KebabIcon, MenuDivider, MenuItem } from "../Menu";
import ModalForm, { TextInput, Textarea, btnPrimaryClass } from "../ModalForm";
import TabBar, { type TabItem } from "../TabBar";
import { useCreateItem, useDeleteItem, useItems, useUpdateItem, type Item } from "../../api/items";

const BTN_ICON =
  "inline-flex items-center justify-center rounded-md border border-slate-300 bg-surface p-1.5 text-slate-700 hover:bg-slate-50 disabled:opacity-50";

/** Pencil (edit) glyph for the row menu's Edit item. */
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

/** Trash (delete) glyph for the row menu's Delete item. */
function TrashIcon() {
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
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
    </svg>
  );
}

// Category tabs: "All", then one per category (A→Z), then "Uncategorized" if any
// item has none. The two fixed tabs use sentinel values that can't collide with
// a real category name, which is never blank.
const ALL = "";
const UNCATEGORIZED = " ";

const categoryOf = (item: Item) => item.category?.trim() || UNCATEGORIZED;

/** Muted "(n)" count after a tab's label, a step smaller than the label. */
function CountBadge({ n }: { n: number }) {
  return <span className="text-[10px] tabular-nums text-slate-500">({n})</span>;
}

function categoryTabs(items: Item[]): TabItem<string>[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const c = categoryOf(item);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const tab = (value: string, label: string): TabItem<string> => ({
    value,
    label,
    // Only ALL has no entry in `counts`: it counts everything.
    badge: <CountBadge n={counts.get(value) ?? items.length} />,
  });
  const named = [...counts.keys()]
    .filter((c) => c !== UNCATEGORIZED)
    .sort((a, b) => a.localeCompare(b));
  return [
    tab(ALL, "All"),
    ...named.map((c) => tab(c, c)),
    ...(counts.has(UNCATEGORIZED) ? [tab(UNCATEGORIZED, "Uncategorized")] : []),
  ];
}

const EMPTY_FORM = { name: "", category: "", amount: "", date: "", description: "" };

type FieldErrors = { name?: string; amount?: string; date?: string };

/**
 * Light client-side validation: name is required; amount (when filled) must parse
 * as a number; date (when filled) must be a real date. Returns only the fields that
 * are currently invalid, so an empty result means the form is submittable.
 */
function validate(form: typeof EMPTY_FORM): FieldErrors {
  const errors: FieldErrors = {};
  if (!form.name.trim()) errors.name = "Name required";
  if (form.amount.trim() && Number.isNaN(Number(form.amount))) errors.amount = "Must be a number";
  if (form.date.trim() && Number.isNaN(Date.parse(form.date))) errors.date = "Invalid date";
  return errors;
}

/** Numeric/date cells arrive as strings; format them for display (null -> "—"). */
function formatAmount(value: string | null): string {
  if (value == null || value.trim() === "") return "—";
  const n = Number(value);
  return Number.isNaN(n)
    ? value
    : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Add/edit form, wrapped in the shared ModalForm kit. Mounted only when the modal
 * is open (see ItemsTab) so form state can be seeded from `editing` with useState
 * initializers — no reset useEffect. This is the canonical example of building a
 * modal form from ModalForm + the field primitives.
 */
function ItemFormModal({
  editing,
  onClose,
  createItem,
  updateItem,
  deleteItem,
}: {
  editing: Item | null;
  onClose: () => void;
  createItem: ReturnType<typeof useCreateItem>;
  updateItem: ReturnType<typeof useUpdateItem>;
  deleteItem: ReturnType<typeof useDeleteItem>;
}) {
  const [form, setForm] = useState(() =>
    editing
      ? {
          name: editing.name,
          category: editing.category ?? "",
          amount: editing.amount ?? "",
          date: editing.date ?? "",
          description: editing.description ?? "",
        }
      : EMPTY_FORM,
  );
  const [formError, setFormError] = useState<string | null>(null);
  // Which fields the user has interacted with (blur/submit): we only surface an
  // inline error once a field is touched, so a pristine add form isn't pre-flagged.
  const [touched, setTouched] = useState<{ name?: boolean; amount?: boolean; date?: boolean }>({});

  const setField = (key: keyof typeof EMPTY_FORM) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));
  const markTouched = (key: keyof FieldErrors) => () =>
    setTouched((prev) => ({ ...prev, [key]: true }));

  // Errors are recomputed from form state every render, so they clear the moment
  // the user corrects a field.
  const errors = validate(form);
  const hasErrors = Object.keys(errors).length > 0;

  const saving = createItem.isPending || updateItem.isPending;

  const handleSubmit = () => {
    if (hasErrors) {
      // Reveal every inline error and block the submit.
      setTouched({ name: true, amount: true, date: true });
      return;
    }
    const data = {
      name: form.name.trim(),
      category: form.category.trim() || null,
      amount: form.amount.trim() || null,
      date: form.date || null,
      description: form.description.trim() || null,
    };
    const opts = {
      onSuccess: onClose,
      onError: (err: unknown) => setFormError((err as Error).message),
    };
    if (editing) updateItem.mutate({ id: editing.id, data }, opts);
    else createItem.mutate(data, opts);
  };

  // Destructive action lives with edit (add mode has nothing to delete). Confirm
  // by name, then delete; close on success, surface failures in the error banner.
  const handleDelete = () => {
    if (!editing) return;
    if (!window.confirm(`Delete "${editing.name}"?`)) return;
    deleteItem.mutate(editing.id, {
      onSuccess: onClose,
      onError: (err: unknown) => setFormError((err as Error).message),
    });
  };

  return (
    <ModalForm
      title={editing ? "Edit item" : "Add item"}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitLabel={editing ? "Save changes" : "Add item"}
      submitting={saving}
      submitDisabled={hasErrors}
      error={formError}
      onDelete={editing ? handleDelete : undefined}
      deleting={deleteItem.isPending}
    >
      <TextInput
        label="Name"
        required
        value={form.name}
        onChange={(e) => setField("name")(e.target.value)}
        onBlur={markTouched("name")}
        error={touched.name ? errors.name : undefined}
        placeholder="e.g. Widget"
      />
      <TextInput
        label="Category"
        value={form.category}
        onChange={(e) => setField("category")(e.target.value)}
        placeholder="e.g. widgets"
      />
      <TextInput
        label="Amount"
        type="number"
        step="0.01"
        min="0"
        value={form.amount}
        onChange={(e) => setField("amount")(e.target.value)}
        onBlur={markTouched("amount")}
        error={touched.amount ? errors.amount : undefined}
        placeholder="e.g. 19.99"
      />
      <TextInput
        label="Date"
        type="date"
        value={form.date}
        onChange={(e) => setField("date")(e.target.value)}
        onBlur={markTouched("date")}
        error={touched.date ? errors.date : undefined}
      />
      <Textarea
        label="Description"
        value={form.description}
        onChange={(e) => setField("description")(e.target.value)}
        placeholder="Optional"
      />
    </ModalForm>
  );
}

export default function ItemsTab() {
  const { data: items, isLoading, isError, error } = useItems();
  const createItem = useCreateItem();
  const updateItem = useUpdateItem();
  const deleteItem = useDeleteItem();

  // Add/edit modal state. editing === null → adding; otherwise editing that row.
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);

  // Selected category tab. If its last item is deleted or recategorized, the tab
  // disappears and the page falls back to All.
  const [category, setCategory] = useState(ALL);
  const tabs = items ? categoryTabs(items) : [];
  const selected = tabs.some((t) => t.value === category) ? category : ALL;
  const shown = items?.filter((item) => selected === ALL || categoryOf(item) === selected);

  const closeModal = () => {
    setOpen(false);
    setEditing(null);
  };

  const openAdd = () => {
    setEditing(null);
    setOpen(true);
  };

  const openEdit = (item: Item) => {
    setEditing(item);
    setOpen(true);
  };

  // The row menu's Delete: confirm by name, then delete. There's no modal open to
  // hold an error banner, so a failure is shown in an alert.
  const deleteRow = (item: Item) => {
    if (!window.confirm(`Delete "${item.name}"?`)) return;
    deleteItem.mutate(item.id, {
      onError: (err: unknown) => window.alert((err as Error).message),
    });
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <p className="text-sm text-slate-600">
          A full add, edit and delete example over the app’s own Postgres table.
        </p>
        <button type="button" className={btnPrimaryClass} onClick={openAdd}>
          + New item
        </button>
      </div>

      {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {isError && (
        <p className="text-sm text-red-600">Failed to load items: {(error as Error).message}</p>
      )}

      {items && items.length > 0 && (
        <TabBar
          tabs={tabs}
          value={selected}
          onSelect={setCategory}
          ariaLabel="Item categories"
          className="mb-4 border-b border-slate-300"
        />
      )}

      {shown && (
        <table className="w-full overflow-hidden rounded-lg border border-slate-200 bg-surface text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Category</th>
              <th className="px-4 py-2 text-right font-medium">Amount</th>
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 font-medium">Description</th>
              <th className="px-4 py-2 font-medium" aria-label="Actions" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {shown.map((item) => (
              <tr key={item.id}>
                <td className="px-4 py-2 font-medium text-slate-900">{item.name}</td>
                <td className="px-4 py-2 text-slate-600">{item.category ?? "—"}</td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                  {formatAmount(item.amount)}
                </td>
                <td className="px-4 py-2 text-slate-600">{item.date ?? "—"}</td>
                <td className="px-4 py-2 text-slate-600">{item.description ?? "—"}</td>
                <td className="px-4 py-2">
                  {/* Row actions: a ⋮ menu built with Menu, which places itself
                      (it opens upward on the last rows). Every popup is built this
                      way; see "Popups and menus" in the frontend README. */}
                  <div className="flex justify-end">
                    <Menu
                      minWidthClass="min-w-[128px]"
                      trigger={(props) => (
                        <button
                          type="button"
                          {...props}
                          className={BTN_ICON}
                          aria-label={`Actions for ${item.name}`}
                          title="Actions"
                        >
                          <KebabIcon />
                        </button>
                      )}
                    >
                      <MenuItem icon={<PencilIcon />} onSelect={() => openEdit(item)}>
                        Edit
                      </MenuItem>
                      <MenuDivider />
                      <MenuItem icon={<TrashIcon />} tone="danger" onSelect={() => deleteRow(item)}>
                        Delete
                      </MenuItem>
                    </Menu>
                  </div>
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  No items yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {open && (
        <ItemFormModal
          editing={editing}
          onClose={closeModal}
          createItem={createItem}
          updateItem={updateItem}
          deleteItem={deleteItem}
        />
      )}
    </div>
  );
}
