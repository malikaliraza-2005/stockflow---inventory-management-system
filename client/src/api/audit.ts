/**
 * Typed audit-logs client — the 05 §7.6 read surface (F7 Audit Trail tab).
 * Admin-only; append-only (DES-1). Types from the generated contract. Rows carry
 * resolved actorName, the DN-4 entityLabel (survives hard deletes), optional
 * before/after changes[] (entity diffs), and security events.
 */
import { api } from './client';
import type { components } from '../types/api';

export type AuditLogRow = components['schemas']['AuditLogRow'];
export type AuditEntityType = AuditLogRow['entityType'];

export interface AuditLogsListParams {
  page?: number | undefined;
  entityType?: AuditEntityType | undefined;
  entityId?: string | undefined;
  actorId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

export interface AuditLogsListResponse {
  data: AuditLogRow[];
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
}

export async function listAuditLogs(params: AuditLogsListParams): Promise<AuditLogsListResponse> {
  const response = await api.get<AuditLogsListResponse>('/audit-logs', { params });
  return response.data;
}
