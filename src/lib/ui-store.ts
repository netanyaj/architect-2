"use client";

import { create } from "zustand";

/** Small UI-only state. Server state lives in Supabase. */
type UiState = {
  helpOpen: boolean;
  /** Project the Help panel is about, when opened from a project header. */
  helpProjectId: string | null;
  openHelp: (projectId?: string | null) => void;
  closeHelp: () => void;
};

export const useUi = create<UiState>((set) => ({
  helpOpen: false,
  helpProjectId: null,
  openHelp: (projectId = null) => set({ helpOpen: true, helpProjectId: projectId }),
  closeHelp: () => set({ helpOpen: false }),
}));
