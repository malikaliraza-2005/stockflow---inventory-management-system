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
  /**
   * Bumped on EVERY session transition. A refresh that started before a
   * transition and fails after it is answering about a session that no longer
   * exists — comparing the epoch it captured lets the caller drop that stale
   * answer instead of tearing down the live session (the bootstrap-vs-login
   * race: a slow `/auth/refresh` 401 landing after a successful login used to
   * clear the brand-new session and bounce the user back to /login).
   */
  epoch: number;
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
  epoch: 0,

  setSession: (accessToken, user) =>
    set((state) => ({ accessToken, user, status: 'authenticated', epoch: state.epoch + 1 })),

  updateUser: (patch) =>
    set((state) => (state.user ? { user: { ...state.user, ...patch } } : state)),

  clearSession: () =>
    set((state) => ({
      accessToken: null,
      user: null,
      status: 'unauthenticated',
      epoch: state.epoch + 1,
    })),
}));

/** The current session generation — capture before an await, compare after. */
export function sessionEpoch(): number {
  return useAuthStore.getState().epoch;
}

// Atomic selectors (SMA §9 — narrowest slice per subscription)
export const selectIsAuthenticated = (s: AuthState) => s.status === 'authenticated';
export const selectStatus = (s: AuthState) => s.status;
export const selectUser = (s: AuthState) => s.user;
export const selectRole = (s: AuthState) => s.user?.role ?? null;
export const selectMustChangePassword = (s: AuthState) => s.user?.mustChangePassword ?? false;
