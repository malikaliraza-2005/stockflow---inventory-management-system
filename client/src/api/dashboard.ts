/**
 * Typed dashboard client — the 05 §7.7 aggregate (F9). One cached call returns
 * every metric + both chart series (FR-DASH-03). Types from the generated
 * contract; the response carries its own `asOf` staleness stamp (BR-25).
 */
import { api } from './client';
import type { components } from '../types/api';

export type DashboardSummary = components['schemas']['DashboardSummary'];
export type DashboardAlertItem = components['schemas']['DashboardAlertItem'];
export type MovementTrendPoint = components['schemas']['MovementTrendPoint'];
export type TransactionVolumePoint = components['schemas']['TransactionVolumePoint'];

/** The three FR-DASH-02 windows, in days. */
export const DASHBOARD_RANGES = [7, 30, 90] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

export async function getDashboardSummary(range: DashboardRange): Promise<DashboardSummary> {
  const response = await api.get<DashboardSummary>('/dashboard/summary', { params: { range } });
  return response.data;
}
