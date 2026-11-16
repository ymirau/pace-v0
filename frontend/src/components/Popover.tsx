import {
  autoUpdate,
  flip,
  FloatingFocusManager,
  FloatingNode,
  FloatingPortal,
  FloatingTree,
  hide,
  offset,
  shift,
  size,
  useClick,
  useDismiss,
  useFloating,
  useFloatingNodeId,
  useFloatingParentNodeId,
  useFloatingTree,
  useInteractions,
  useRole,
  type Middleware,
  type Placement,
} from "@floating-ui/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useInRouterContext, useLocation } from "react-router-dom";

/**
 * The one way to build a popup in this app: a dropdown, a ⋮ menu, a filter panel.
 * For action menus use `Menu` (Menu.tsx), which is built on this.
 *
 * It places itself from the room around its trigger: `placement` is only a
 * preference, and it flips up/down and left/right, shifts to stay on-screen, and
 * caps its height (scrolling inside) when nothing fits. It renders in a portal
 * under <body> with fixed positioning, so no scroll or overflow container can
 * clip it. It closes on outside click, Esc, a route change, or its trigger
 * scrolling out of view; focus moves into it on open and back to the trigger on
 * close. Popovers nest: one opened from inside another (RoleBadge inside the
 * rail's account menu) keeps its parent open, Esc closes the innermost first, and
 * `closeAll()` closes the whole chain.
 *
 * Never hand-roll absolute positioning or outside-click / Esc listeners for a
 * popup: build it on this (see "Popups and menus" in the frontend README).
 */

// Gap between trigger and popup, and the margin kept from the viewport edge.
const GAP = 6;
const EDGE = 8;

/** Props for the trigger element: spread them, ref included, onto a <button>. */
export type PopoverTriggerProps = Record<string, unknown> & {
  ref: (node: HTMLElement | null) => void;
};

export interface PopoverProps {
  /** Renders the trigger; spread `props` (ref included) onto the button. */
  trigger: (props: PopoverTriggerProps, open: boolean) => ReactNode;
  children: ReactNode;
  /** Preferred side; flipped/shifted when it doesn't fit. */
  placement?: Placement;
  /** ARIA role of the popup ("menu" for Menu). */
  role?: "dialog" | "menu" | "listbox";
  /** Classes for the popup panel (look and width). */
  className?: string;
  /** CSS selector of the element to focus on open; defaults to the first tabbable. */
  initialFocusSelector?: string;
  /** Controlled mode; omit both to let the popover own its state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

type PopoverApi = {
  /** Close this popover only. */
  close: () => void;
  /** Close this popover and every popover it's nested in. */
  closeAll: () => void;
};

const PopoverContext = createContext<PopoverApi | null>(null);

/** Inside a popover's content: close it, or close the whole nested chain. */
// eslint-disable-next-line react-refresh/only-export-components
export function usePopover(): PopoverApi {
  const api = useContext(PopoverContext);
  if (!api) throw new Error("usePopover() must be used inside a <Popover>");
  return api;
}

const CLOSE_ALL = "popover:closeAll";

export default function Popover(props: PopoverProps) {
  // A top-level popover starts its own tree; a nested one joins its parent's, so
  // the parent knows clicks in the child aren't "outside". Callers never add a
  // provider themselves.
  const parentId = useFloatingParentNodeId();
  if (parentId === null) {
    return (
      <FloatingTree>
        <PopoverInner {...props} />
      </FloatingTree>
    );
  }
  return <PopoverInner {...props} />;
}

function PopoverInner({
  trigger,
  children,
  placement = "bottom-start",
  role = "dialog",
  className = "",
  initialFocusSelector,
  open: openProp,
  onOpenChange,
}: PopoverProps) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = useCallback(
    (next: boolean) => {
      if (openProp === undefined) setOpenState(next);
      onOpenChange?.(next);
    },
    [openProp, onOpenChange],
  );

  const nodeId = useFloatingNodeId();
  const tree = useFloatingTree();

  // Close once the trigger has scrolled fully out of view, checked on every
  // position update (scroll, resize). A 0×0 trigger also reads as "hidden", and
  // that's every element in jsdom (no layout) or a display:none trigger, so only
  // act on a trigger that really has a size.
  const closeRef = useRef(() => {});
  useEffect(() => {
    closeRef.current = () => setOpen(false);
  }, [setOpen]);
  const closeWhenHidden: Middleware = {
    name: "closeWhenHidden",
    fn({ middlewareData, rects }) {
      const { width, height } = rects.reference;
      if (middlewareData.hide?.referenceHidden && width + height > 0) closeRef.current();
      return {};
    },
  };

  const { refs, floatingStyles, context } = useFloating({
    nodeId,
    open,
    onOpenChange: setOpen,
    placement,
    strategy: "fixed",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(GAP),
      flip({ padding: EDGE }),
      shift({ padding: EDGE }),
      size({
        padding: EDGE,
        apply({ availableHeight, elements }) {
          elements.floating.style.maxHeight = `${Math.max(0, availableHeight)}px`;
        },
      }),
      hide(),
      closeWhenHidden,
    ],
  });

  const { getReferenceProps, getFloatingProps } = useInteractions([
    useClick(context),
    // Esc closes only the innermost popover; an outside click closes them all.
    useDismiss(context, { bubbles: { escapeKey: false } }),
    useRole(context, { role }),
  ]);

  // closeAll(): every popover in the tree listens, so a pick in a nested menu
  // closes its parent too.
  useEffect(() => {
    if (!tree) return;
    const onCloseAll = () => setOpen(false);
    tree.events.on(CLOSE_ALL, onCloseAll);
    return () => tree.events.off(CLOSE_ALL, onCloseAll);
  }, [tree, setOpen]);

  // Pick the element to focus on open. Callback refs run after the panel's
  // children are in the DOM and before FloatingFocusManager's effect reads this.
  const initialFocusRef = useRef<HTMLElement | null>(null);
  const setFloating = useCallback(
    (el: HTMLElement | null) => {
      refs.setFloating(el);
      initialFocusRef.current =
        el && initialFocusSelector ? el.querySelector<HTMLElement>(initialFocusSelector) : null;
    },
    [refs, initialFocusSelector],
  );

  const api: PopoverApi = {
    close: () => setOpen(false),
    closeAll: () => (tree ? tree.events.emit(CLOSE_ALL) : setOpen(false)),
  };

  const inRouter = useInRouterContext();

  return (
    <FloatingNode id={nodeId}>
      {trigger({ ref: refs.setReference, ...getReferenceProps() }, open)}
      {open && (
        <FloatingPortal>
          {inRouter && <CloseOnNavigate onNavigate={() => setOpen(false)} />}
          <FloatingFocusManager
            context={context}
            modal={false}
            initialFocus={initialFocusSelector ? initialFocusRef : 0}
          >
            <div
              ref={setFloating}
              style={floatingStyles}
              // Above the page and sidebar, below modals (Modal is z-[100]).
              className={`z-50 overflow-y-auto ${className}`}
              {...getFloatingProps()}
            >
              <PopoverContext.Provider value={api}>{children}</PopoverContext.Provider>
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </FloatingNode>
  );
}

/** Mounted only while open: closes the popover when the route's path changes.
 *  Kept apart so Popover still works outside a router (unit tests). */
function CloseOnNavigate({ onNavigate }: { onNavigate: () => void }) {
  const { pathname } = useLocation();
  const openedAt = useRef(pathname);
  useEffect(() => {
    if (pathname !== openedAt.current) onNavigate();
  }, [pathname, onNavigate]);
  return null;
}
