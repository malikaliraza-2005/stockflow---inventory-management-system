/**
 * Session orchestration — the SMA §7 single owner of every session
 * transition. Sits BELOW api/client (no import cycle): the interceptor and
 * the auth client both call into here.
 *
 *  - applySession: one write path for login/refresh payloads — authStore +
 *    settingsStore hydration (FCM-01) together, always.
 *  - performRefresh: the ONE refresh call (ARB-03) — bare axios on purpose:
 *    it must never pass through the 401 interceptor it serves.
 *  - endSession(reason): the ONLY teardown sequence (SMA §7) — no other code
 *    path resets session state.
 *
 * Navigation is injected (registerSessionEndNavigator) — this module knows
 * nothing about the router.
 */
import axios from 'axios';

import { getConfig } from '../config';
import { useAuthStore, type SessionEndReason } from '../stores/authStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useUiStore } from '../stores/uiStore';
import type { components } from '../types/api';

export type SessionResponse = components['schemas']['SessionResponse'];

/** Login/refresh 200 → stores. Returns the access token for the caller. */
export function applySession(payload: SessionResponse): string {
  useAuthStore.getState().setSession(payload.accessToken, payload.user);
  useSettingsStore.getState().setSettings({
    currency: payload.settings.systemCurrency,
    movementWarningThreshold: payload.settings.movementWarningThreshold,
  });
  return payload.accessToken;
}

/**
 * POST /auth/refresh with the httpOnly cookie. Throws on any failure —
 * callers decide between endSession (interceptor) and quiet
 * unauthenticated bootstrap (app load).
 */
export async function performRefresh(): Promise<string> {
  const response = await axios.post<SessionResponse>(
    `${getConfig().apiBaseUrl}/api/v1/auth/refresh`,
    undefined,
    { withCredentials: true },
  );
  return applySession(response.data);
}

type SessionEndNavigator = (reason: SessionEndReason) => void;
let navigateOnSessionEnd: SessionEndNavigator | undefined;

/** App wiring registers the router hop; tests register a spy. */
export function registerSessionEndNavigator(navigator: SessionEndNavigator): void {
  navigateOnSessionEnd = navigator;
}

/** SMA §7 — the four steps, in order, nowhere else. */
export function endSession(reason: SessionEndReason): void {
  useAuthStore.getState().clearSession(reason);
  useSettingsStore.getState().clear();
  useUiStore.getState().resetForSessionEnd();
  navigateOnSessionEnd?.(reason);
}
