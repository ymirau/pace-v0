import { useEffect } from "react";

import Modal from "./Modal";
import { btnClass, btnPrimaryClass } from "./ModalForm";

interface SignOutDialogProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * "Sign out?" — asked before Sign out, because a stray click ended the session
 * and signing back in is a chore. Cancel is the first button and the safe one;
 * Escape and the ✕ cancel too. Never window.confirm: untestable, unstyleable,
 * and off a phone-width viewport.
 *
 * The open state lives in Layout, not in the ⋮ SettingsMenu that holds the Sign
 * out item: that menu closes on any outside click, and the dialog is "outside"
 * it, so a dialog kept there would vanish with it. The menu just hands off via
 * its onSignOut prop. An app with several such menus (e.g. phone and tablet
 * account menus) needs a small shared store and the dialog mounted once in the
 * shell.
 */
export default function SignOutDialog({ open, onCancel, onConfirm }: SignOutDialogProps) {
  // Modal ignores Escape so a form's typing is never thrown away; this dialog
  // holds no input, so Escape is just another Cancel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  return (
    <Modal
      open={open}
      title="Sign out?"
      onClose={onCancel}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={btnClass} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={btnPrimaryClass} onClick={onConfirm}>
            Sign out
          </button>
        </div>
      }
    >
      <p className="pt-3 text-sm text-slate-600">You'll need to sign in again to use the app.</p>
    </Modal>
  );
}
