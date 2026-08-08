import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { NavMode } from '@/config/navigation';

interface NavModeState {
  mode: NavMode;
  setMode: (mode: NavMode) => void;
}

/**
 * Which sidebar the user is looking at: the form builder, or the data-entry
 * app surface.
 *
 * Persisted, because it is a working context rather than a navigation event —
 * someone who spends their day in Data Apps should not be dropped back into
 * Forms every time they reload.
 *
 * Defaults to 'forms' so an installation without the FORM_APPS flag, or a user
 * who has never switched, sees exactly the product they had before.
 */
export const useNavModeStore = create<NavModeState>()(
  persist(
    (set) => ({
      mode: 'forms',
      setMode: (mode) => set({ mode }),
    }),
    { name: 'formbuilder.nav-mode' },
  ),
);
