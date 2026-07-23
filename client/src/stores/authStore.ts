/**
 * authStore — SMA §3, 1:1. Session identity for guards, interceptors, and
 * permission checks.
 *
 *  - `accessToken` lives in MEMORY ONLY (A-7/SEC-01) — never persisted; the
 *    httpOnly refresh cookie is the cross-refresh continuity.
 *  - NO async here: the api layer writes this store, never the reverse —
 *    single-flight refresh has exactly one home (api/client).
 *  - `status: 'initializing'` gates first paint (bootstrap refresh, no login
 *    flash).
 */
import { create } from 'zustand';

import type { components } from '../types/api';

export type SessionUser = components['schemas']['SessionUser'];

export type AuthStatus = 'initializing' | 'authenticated' | 'unauthenticated';
export type SessionEndReason = 'logout' | 'expired' | 'deactivated';

export interface AuthState {
  accessToken: string | null;
  user: SessionUser | null;
  status: AuthStatus;
}

export interface AuthActions {
  setSession(token: string, user: SessionUser): void;
  updateUser(patch: Partial<SessionUser>): void;
  clearSession(reason?: SessionEndReason): void;
}

export const useAuthStore = create<AuthState & AuthActions>()((set) => ({
  accessToken: null,
  user: null,
  status: 'initializing',

  setSession: (accessToken, user) => set({ accessToken, user, status: 'authenticated' }),

  updateUser: (patch) =>
    set((state) => (state.user ? { user: { ...state.user, ...patch } } : state)),

  clearSession: () => set({ accessToken: null, user: null, status: 'unauthenticated' }),
}));

// Atomic selectors (SMA §9 — narrowest slice per subscription)
export const selectIsAuthenticated = (s: AuthState) => s.status === 'authenticated';
export const selectStatus = (s: AuthState) => s.status;
export const selectUser = (s: AuthState) => s.user;
export const selectRole = (s: AuthState) => s.user?.role ?? null;
export const selectMustChangePassword = (s: AuthState) => s.user?.mustChangePassword ?? false;
