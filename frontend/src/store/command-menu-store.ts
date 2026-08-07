'use client';

import { create } from 'zustand';

/**
 * Open state for the ⌘K palette, lifted out of the component so the header's
 * search button can trigger it. Previously the state was local to CommandMenu,
 * which is why the header rendered a decorative search input that did nothing.
 */
interface CommandMenuState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  setOpen: (open: boolean) => void;
}

export const useCommandMenuStore = create<CommandMenuState>()((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
  setOpen: (isOpen) => set({ isOpen }),
}));
