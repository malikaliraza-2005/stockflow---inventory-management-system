/**
 * Typed transactions client — the 05 §7.6 read surface (F7 ledger tab). The
 * append-only ledger; both roles read. Types from the generated contract.
 */
import { api } from './client';
import type { components } from '../types/api';

export type TransactionRow = components['schemas']['TransactionRow'];
export type TransactionType = TransactionRow['type'];

export interface TransactionsListParams {
  page?: number | undefined;
  limit?: number | undefined;
  from?: string | undefined;
  to?: string | undefined;
  type?: TransactionType | undefined;
  productId?: string | undefined;
  userId?: string | undefined;
  includeArchived?: boolean | undefined;
}

export interface TransactionsListResponse {
  data: TransactionRow[];
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
}

export async function listTransactions(
  params: TransactionsListParams,
): Promise<TransactionsListResponse> {
  const response = await api.get<TransactionsListResponse>('/transactions', { params });
  return response.data;
}
