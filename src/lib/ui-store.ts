"use client";

import { create } from "zustand";

/** Small UI-only state. Server state lives in Supabase. */
type UiState = {
  helpOpen: boolean;
  /** Project the Help panel is about, when opened from a project header. */
  helpProjectId: string | null;
  openHelp: (projectId?: string | null) => void;
  closeHelp: () => void;
  /** The part whose drawer is open (by key), in the project workspace. */
  partKey: string | null;
  openPart: (key: string | null) => void;
  /** Text handed to the chat composer (Point at something, Fix with AI); the composer takes it once. */
  chatDraft: { text: string; n: number } | null;
  sendToChat: (text: string) => void;
  takeChatDraft: () => void;
  /** Unsaved changes in the open agent's settings (Agents view): the stage action waits for Save or Discard. */
  agentChanges: number;
  /** The agent whose settings are open on the right (Agents view), by part key. */
  agentKey: string | null;
  openAgent: (key: string | null) => void;
  setAgentChanges: (n: number) => void;
  /** The Changes review panel (repo projects, M5.5 review). */
  changesOpen: boolean;
  openChanges: (open: boolean) => void;
  /** The app preview's size (M5.8: its switch sits in the project header, beside the tabs). */
  previewSize: "desktop" | "phone";
  setPreviewSize: (size: "desktop" | "phone") => void;
  /** One toast at a time, bottom-centre (e.g. "Moved to Trash · Undo · View Trash"). Survives client navigation. */
  /** The ⌘K command palette (M5.10). */
  paletteOpen: boolean;
  openPalette: (open: boolean) => void;
  toast: Toast | null;
  showToast: (t: Omit<Toast, "n">) => void;
  dismissToast: () => void;
};

export type Toast = { n: number; text: string; undo?: { label: string; projectId: string }; link?: { label: string; href: string } };

export const useUi = create<UiState>((set) => ({
  helpOpen: false,
  helpProjectId: null,
  openHelp: (projectId = null) => set({ helpOpen: true, helpProjectId: projectId }),
  closeHelp: () => set({ helpOpen: false }),
  partKey: null,
  openPart: (key) => set({ partKey: key }),
  chatDraft: null,
  sendToChat: (text) => set((s) => ({ chatDraft: { text, n: (s.chatDraft?.n ?? 0) + 1 } })),
  takeChatDraft: () => set({ chatDraft: null }),
  agentChanges: 0,
  agentKey: null,
  openAgent: (key) => set({ agentKey: key }),
  setAgentChanges: (n) => set({ agentChanges: n }),
  changesOpen: false,
  openChanges: (open) => set({ changesOpen: open }),
  previewSize: "desktop",
  setPreviewSize: (size) => set({ previewSize: size }),
  paletteOpen: false,
  openPalette: (open) => set({ paletteOpen: open }),
  toast: null,
  showToast: (t) => set((s) => ({ toast: { ...t, n: (s.toast?.n ?? 0) + 1 } })),
  dismissToast: () => set({ toast: null }),
}));
