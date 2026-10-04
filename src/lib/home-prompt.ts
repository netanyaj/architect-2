"use client";

import { create } from "zustand";

/** Home's prompt and the Templates dialog, shared by the composer and the "Start from a working idea" cards. */
export const useHomePrompt = create<{
  prompt: string;
  setPrompt: (prompt: string) => void;
  templatesOpen: boolean;
  setTemplatesOpen: (open: boolean) => void;
}>((set) => ({
  prompt: "",
  setPrompt: (prompt) => set({ prompt }),
  templatesOpen: false,
  setTemplatesOpen: (templatesOpen) => set({ templatesOpen }),
}));
