import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

import Modal from "./Modal";

// Shared building blocks for the app's modal forms. Each form used to hand-roll
// the same skeleton (Modal + error banner + label/field/inline-error rows +
// Cancel/Submit footer + saving state); these primitives are the single source of
// truth for that pattern. Keep it lightweight - this is not a schema-driven form
// engine, just consistent styling + layout for hand-written forms.

// Style tokens (exported for the odd bespoke control, e.g. an inline "+ Add new").
// Fields fill with bg-surface, a shade off the bg-slate-50 modal they sit in.
export const inputClass = "w-full rounded-md border border-slate-300 bg-surface px-3 py-2 text-sm";
export const btnClass =
  "inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-surface px-3.5 py-1.5 text-xs font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-50";
export const btnPrimaryClass =
  "inline-flex items-center gap-1.5 rounded-md border border-slate-900 bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-surface hover:bg-slate-700 disabled:opacity-50";
export const btnDangerClass =
  "inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-surface px-3.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50";

/** Form-level message banner: red for errors, amber for soft warnings. */
export function FormBanner({
  variant = "error",
  children,
}: {
  variant?: "error" | "warning";
  children: ReactNode;
}) {
  const tone =
    variant === "warning" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-600";
  return <div className={`mb-2.5 rounded-md px-3 py-2 text-xs ${tone}`}>{children}</div>;
}

/**
 * A labeled field row: optional label (+ required marker), the control (passed as
 * children), and an optional inline error. Owns the row's vertical rhythm so
 * callers don't juggle margin classes. Use it directly for bespoke controls (e.g.
 * a cascading select with an inline "add new" toggle); for plain inputs reach for
 * TextInput / Textarea / SelectField below.
 */
export function Field({
  label,
  required,
  error,
  children,
}: {
  label?: ReactNode;
  required?: boolean;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-3">
      {label !== undefined && (
        <label className="mb-1 block text-xs text-slate-600">
          {label}
          {required && <span className="text-red-600"> *</span>}
        </label>
      )}
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

type FieldShellProps = { label?: ReactNode; required?: boolean; error?: string };

/** Labeled text input (any HTML input type). */
export function TextInput({
  label,
  required,
  error,
  className,
  ...props
}: FieldShellProps & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} required={required} error={error}>
      <input className={className ? `${inputClass} ${className}` : inputClass} {...props} />
    </Field>
  );
}

/** Labeled textarea. */
export function Textarea({
  label,
  required,
  error,
  className,
  ...props
}: FieldShellProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Field label={label} required={required} error={error}>
      <textarea className={className ? `${inputClass} ${className}` : inputClass} {...props} />
    </Field>
  );
}

/** Labeled select; pass <option>s as children. */
export function SelectField({
  label,
  required,
  error,
  className,
  children,
  ...props
}: FieldShellProps & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Field label={label} required={required} error={error}>
      <select className={className ? `${inputClass} ${className}` : inputClass} {...props}>
        {children}
      </select>
    </Field>
  );
}

interface ModalFormProps {
  /** Callers usually mount-on-open, so this defaults to true. */
  open?: boolean;
  title: ReactNode;
  titleTooltip?: string;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel: string;
  /** True while the create/update mutation is in flight (shows "Saving…"). */
  submitting?: boolean;
  /** Extra guard to disable submit (e.g. a hard validation block). */
  submitDisabled?: boolean;
  /** Top red error banner (e.g. a surfaced API error). */
  error?: string | null;
  /** Extra banner rendered under the error (e.g. an amber soft-warning). */
  banner?: ReactNode;
  /** When provided, a Delete button appears at the left of the footer. */
  onDelete?: () => void;
  deleteLabel?: string;
  deleting?: boolean;
  children: ReactNode;
}

/**
 * Modal-wrapped form scaffold: renders the Modal, an optional error banner + extra
 * banner slot, the caller's fields, and a footer with Cancel / Submit (plus an
 * optional Delete on the left). Buttons are plain onClick (not a native form
 * submit) to stay behavior-compatible with the existing forms, which manage their
 * own Enter handling in inline sub-controls.
 */
export default function ModalForm({
  open = true,
  title,
  titleTooltip,
  onClose,
  onSubmit,
  submitLabel,
  submitting,
  submitDisabled,
  error,
  banner,
  onDelete,
  deleteLabel = "Delete",
  deleting,
  children,
}: ModalFormProps) {
  const busy = Boolean(submitting) || Boolean(deleting);
  return (
    <Modal
      open={open}
      title={title}
      titleTooltip={titleTooltip}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-2">
          <div>
            {onDelete && (
              <button type="button" className={btnDangerClass} disabled={busy} onClick={onDelete}>
                {deleting ? "Deleting…" : deleteLabel}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" className={btnClass} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className={btnPrimaryClass}
              disabled={busy || submitDisabled}
              onClick={onSubmit}
            >
              {submitting ? "Saving…" : submitLabel}
            </button>
          </div>
        </div>
      }
    >
      {/* Breathing room below the header divider (matches the footer's inner
          padding; padding not margin so it can't collapse, and it scrolls). */}
      <div className="pt-3.5">
        {error && <FormBanner>{error}</FormBanner>}
        {banner}
        {children}
      </div>
    </Modal>
  );
}
