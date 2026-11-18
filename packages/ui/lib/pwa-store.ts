'use client';

import { create } from 'zustand';

/** Chrome/Edge/Android's deferred install prompt. */
export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface PwaState {
  installPrompt: InstallPromptEvent | null;
  installed: boolean;
  setInstallPrompt: (event: InstallPromptEvent | null) => void;
  setInstalled: (installed: boolean) => void;
}

export const usePwaStore = create<PwaState>((set) => ({
  installPrompt: null,
  installed: false,
  setInstallPrompt: (installPrompt) => set({ installPrompt }),
  setInstalled: (installed) => set({ installed, ...(installed ? { installPrompt: null } : {}) }),
}));
