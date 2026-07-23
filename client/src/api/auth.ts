/**
 * Typed auth client — the 05 §7.1 surface (F1). Thin: every call is one
 * endpoint + the store writes SMA assigns to it. Types come from the
 * generated contract (NFR-27) — never hand-declared.
 */
import { api } from './client';
import { applySession, endSession, performRefresh } from './session';
import { useAuthStore } from '../stores/authStore';
import type { components } from '../types/api';

type SessionResponse = components['schemas']['SessionResponse'];

/** POST /auth/login — success hydrates authStore + settingsStore (FCM-01). */
export async function login(email: string, password: string): Promise<void> {
  const response = await api.post<SessionResponse>('/auth/login', { email, password });
  applySession(response.data);
}

/**
 * App bootstrap (A-7 refresh-on-load): same single refresh call the
 * interceptor uses. Failure is a NORMAL state (no cookie yet) — quiet
 * unauthenticated, no navigation, no toast.
 */
export async function bootstrapSession(): Promise<void> {
  try {
    await performRefresh();
  } catch {
    useAuthStore.getState().clearSession();
  }
}

/** POST /auth/logout — server revokes; teardown via the ONE owner (SMA §7). */
export async function logout(): Promise<void> {
  try {
    await api.post('/auth/logout');
  } finally {
    endSession('logout'); // even if the network call failed — fail closed locally
  }
}

/** POST /auth/reset-password — public token flow (UC-03). */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await api.post('/auth/reset-password', { token, newPassword });
}

/** POST /auth/change-password — clears the forced-change gate on success. */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await api.post('/auth/change-password', { currentPassword, newPassword });
  useAuthStore.getState().updateUser({ mustChangePassword: false });
}
