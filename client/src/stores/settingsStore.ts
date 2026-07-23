/**
 * settingsStore — SMA §5, 1:1. System display constants for formatters and
 * movement UX. Hydrated from the login/refresh session payload's `settings`
 * block (FCM-01, ratified 2026-07-23 — both roles, zero extra requests).
 * No persistence: re-hydrates with the session (stale-persist risks wrong
 * currency rendering).
 */
import { create } from 'zustand';

export interface SettingsState {
  currency: string | null;
  defaultLowStockThreshold: number | null;
  movementWarningThreshold: number | null;
  loaded: boolean;
}

export interface SettingsActions {
  setSettings(payload: {
    currency?: string;
    defaultLowStockThreshold?: number;
    movementWarningThreshold?: number;
  }): void;
  clear(): void;
}

const EMPTY: SettingsState = {
  currency: null,
  defaultLowStockThreshold: null,
  movementWarningThreshold: null,
  loaded: false,
};

export const useSettingsStore = create<SettingsState & SettingsActions>()((set) => ({
  ...EMPTY,

  setSettings: (payload) =>
    set((state) => ({
      currency: payload.currency ?? state.currency,
      defaultLowStockThreshold: payload.defaultLowStockThreshold ?? state.defaultLowStockThreshold,
      movementWarningThreshold: payload.movementWarningThreshold ?? state.movementWarningThreshold,
      loaded: true,
    })),

  clear: () => set(EMPTY),
}));

export const selectCurrency = (s: SettingsState) => s.currency;
export const selectWarningThreshold = (s: SettingsState) => s.movementWarningThreshold;
