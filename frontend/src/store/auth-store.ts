import { create } from 'zustand';

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  systemRole: string;
}

export interface ActiveOrganization {
  id: string;
  name: string;
  slug: string;
  role: string;
}

interface AuthState {
  user: AuthUser | null;
  activeOrganization: ActiveOrganization | null;
  setUser: (user: AuthUser | null, org: ActiveOrganization | null) => void;
  clearUser: () => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  activeOrganization: null,
  setUser: (user, activeOrganization) => set({ user, activeOrganization }),
  clearUser: () => set({ user: null, activeOrganization: null }),
}));
