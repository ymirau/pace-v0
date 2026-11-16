import { useState } from "react";

// The manual sidebar collapse (⋮ menu's Collapse sidebar / the rail's »),
// remembered per browser. Only matters at lg+: below lg the nav is always the icon rail.
const STORAGE_KEY = "nav-collapsed";

/** The stored choice; false when unset, unreadable or storage is blocked. */
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** [collapsed, setCollapsed]: setting it also persists it (best effort). */
export function useNavCollapsed(): [boolean, (collapsed: boolean) => void] {
  const [collapsed, setState] = useState(readCollapsed);
  const setCollapsed = (next: boolean) => {
    setState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      // Private mode / blocked storage: still collapses, just isn't remembered.
    }
  };
  return [collapsed, setCollapsed];
}
