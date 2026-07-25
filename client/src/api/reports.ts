/**
 * Typed reports client — the 05 §7.8 surface (F10). Five paginated reads plus
 * the Admin CSV export. Types from the generated contract. The export returns a
 * Blob (responseType 'blob'); a mid-stream server abort rejects the promise, and
 * the caller shows the ERR §7 retry toast.
 */
import { api } from './client';
import type { TransactionRow } from './transactions';
import type { components } from '../types/api';

export type InventoryReport = components['schemas']['InventoryReport'];
export type InventoryReportRow = components['schemas']['InventoryReportRow'];
export type LowStockReportRow = components['schemas']['LowStockReportRow'];
export type ProductPerformanceReport = components['schemas']['ProductPerformanceReport'];
export type ProductPerformanceRow = components['schemas']['ProductPerformanceRow'];
export type ConsistencyRow = components['schemas']['ConsistencyRow'];

/** The §5 list envelope for the reports that carry no totals row. */
export interface ReportList<T> {
  data: T[];
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
}

export const REPORT_TYPES = [
  'inventory',
  'low-stock',
  'transactions',
  'product-performance',
  'consistency',
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export interface InventoryReportParams {
  page?: number | undefined;
  categoryId?: string | undefined;
  stockStatus?: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' | undefined;
}
export interface DateRangeParams {
  page?: number | undefined;
  from: string;
  to: string;
}
export interface TransactionsReportParams extends DateRangeParams {
  type?: TransactionRow['type'] | undefined;
  productId?: string | undefined;
  userId?: string | undefined;
}

export async function getInventoryReport(params: InventoryReportParams): Promise<InventoryReport> {
  const response = await api.get<InventoryReport>('/reports/inventory', { params });
  return response.data;
}

export async function getLowStockReport(params: {
  page?: number | undefined;
}): Promise<ReportList<LowStockReportRow>> {
  const response = await api.get<ReportList<LowStockReportRow>>('/reports/low-stock', { params });
  return response.data;
}

export async function getTransactionsReport(
  params: TransactionsReportParams,
): Promise<ReportList<TransactionRow>> {
  const response = await api.get<ReportList<TransactionRow>>('/reports/transactions', { params });
  return response.data;
}

export async function getProductPerformanceReport(
  params: DateRangeParams,
): Promise<ProductPerformanceReport> {
  const response = await api.get<ProductPerformanceReport>('/reports/product-performance', {
    params,
  });
  return response.data;
}

export async function getConsistencyReport(params: {
  page?: number | undefined;
}): Promise<ReportList<ConsistencyRow>> {
  const response = await api.get<ReportList<ConsistencyRow>>('/reports/consistency', { params });
  return response.data;
}

/** Admin CSV export — the full filtered dataset as a Blob (05 §7.8, ERR §7). */
export async function exportReport(
  name: ReportType,
  params: Record<string, string | number | undefined>,
): Promise<Blob> {
  const response = await api.get<Blob>(`/reports/${name}/export`, {
    params,
    responseType: 'blob',
  });
  return response.data;
}
