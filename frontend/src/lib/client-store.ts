"use client";

import { useSyncExternalStore } from "react";

/** Reads a localStorage key as external state (no setState-in-effect; SSR-safe). */
const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => { listeners.delete(cb); window.removeEventListener("storage", cb); };
}
export function writeLocal(key: string, value: string | null) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* storage unavailable */ }
  listeners.forEach((l) => l());
}
export function useLocal(key: string): string | null {
  return useSyncExternalStore(subscribe, () => { try { return localStorage.getItem(key); } catch { return null; } }, () => null);
}

/** One-time browser capability check, false during SSR. */
export function useClientValue<T>(compute: () => T, serverValue: T): T {
  return useSyncExternalStore(() => () => {}, compute, () => serverValue);
}
