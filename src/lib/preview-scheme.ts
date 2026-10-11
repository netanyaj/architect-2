"use client";

import { useSyncExternalStore } from "react";
import type { PreviewScheme } from "./themes";

/**
 * The preview's Light / Dark view (M5.8), remembered per project in this browser. It's a viewing convenience, so it
 * lives in localStorage (guarded: private windows can refuse it) and falls back to Light.
 */
const key = (projectId: string) => `ax_preview_scheme:${projectId}`;
const listeners = new Set<() => void>();

function read(projectId: string): PreviewScheme {
  try {
    return window.localStorage.getItem(key(projectId)) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function usePreviewScheme(projectId: string): [PreviewScheme, (s: PreviewScheme) => void] {
  const scheme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => read(projectId),
    () => "light" as const,
  );
  const set = (s: PreviewScheme) => {
    try {
      window.localStorage.setItem(key(projectId), s);
    } catch {
      // Not remembered this time; the view still changes for this page.
      memory.set(projectId, s);
    }
    listeners.forEach((l) => l());
  };
  return [memory.get(projectId) ?? scheme, set];
}

const memory = new Map<string, PreviewScheme>();
