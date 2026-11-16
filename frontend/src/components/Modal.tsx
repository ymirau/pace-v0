import type { ReactNode } from "react";

interface ModalProps {
  open: boolean;
  title: ReactNode;
  /** Optional tooltip (native title attr) shown when hovering the title. */
  titleTooltip?: string;
  onClose: () => void;
  children: ReactNode;
  /**
   * Optional footer region pinned to the bottom. When provided, the header and
   * footer stay fixed and only the body (children) scrolls once it outgrows the
   * viewport. Callers without a footer still get a fixed header + scrolling body.
   */
  footer?: ReactNode;
}

/**
 * Centered modal dialog matching the prototype's .modal-bg / .modal styling.
 * Closes ONLY via the × button (or caller-provided footer buttons) — backdrop
 * clicks and Escape are intentionally ignored so an accidental click never
 * discards in-progress form input. Laid out as a flex column so the header
 * (and optional footer) stay put while the body scrolls on small screens.
 */
export default function Modal({ open, title, titleTooltip, onClose, children, footer }: ModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-backdrop">
      <div className="flex max-h-[90vh] w-[480px] max-w-[95vw] flex-col rounded-[10px] border border-slate-200 bg-slate-50">
        {/* Fixed header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-[22px] py-3.5">
          <span className="text-sm font-medium text-slate-900" title={titleTooltip}>
            {title}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex items-center rounded-md border border-slate-300 bg-surface px-2.5 py-1 text-[11px] text-slate-900 hover:bg-slate-50"
          >
            ✕
          </button>
        </div>
        {/* Scrollable body (min-h-0 lets it shrink below content so it can scroll). */}
        <div className="min-h-0 overflow-y-auto px-[22px] pb-[22px]">{children}</div>
        {/* Fixed footer, when provided. */}
        {footer && (
          <div className="shrink-0 border-t border-slate-200 px-[22px] py-3.5">{footer}</div>
        )}
      </div>
    </div>
  );
}
