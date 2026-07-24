/**
 * Typed settings client — the 05 §7.10 surface (F11). Admin-only. Types from
 * the generated contract. The stored field is `currency` (the session payload's
 * `systemCurrency` alias is a separate concern owned by api/session).
 */
import { api } from './client';
import type { components } from '../types/api';

export type Settings = components['schemas']['Settings'];
export type SettingsUpdateRequest = components['schemas']['SettingsUpdateRequest'];

export async function getSettings(): Promise<Settings> {
  const response = await api.get<Settings>('/settings');
  return response.data;
}

export async function updateSettings(body: SettingsUpdateRequest): Promise<Settings> {
  const response = await api.put<Settings>('/settings', body);
  return response.data;
}
