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
};

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
}));
