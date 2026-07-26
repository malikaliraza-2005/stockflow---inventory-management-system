/**
 * Audit-log row serialization — the wire contract for GET /audit-logs (05 §7.6,
 * F7 Audit Trail tab). Each row joins its actor's display name; `entityLabel`
 * (DN-4) is the display identity captured at WRITE time, so rows still render
 * after the entity is hard-deleted. `changes[]` before/after values were stored
 * already in wire shape (money strings, booleans) by AuditService.computeChanges,
 * so they pass through untouched. Optional fields absent, never null (05 §2).
 */
import type { Types } from 'mongoose';

import type { AuditChange, AuditLogDoc } from '../models/AuditLog.js';

export interface AuditLogRowPayload {
  id: string;
  actorId: string;
  actorName: string;
  entityType: string;
  entityId?: string;
  entityLabel: string;
  action: string;
  changes?: AuditChange[];
  ip?: string;
  createdAt: string;
}

export type AuditLogLean = AuditLogDoc & { _id: Types.ObjectId };

export function serializeAuditLogRow(
  row: AuditLogLean,
  actorName: string | undefined,
): AuditLogRowPayload {
  return {
    id: row._id.toString(),
    actorId: row.actorId.toString(),
    actorName: actorName ?? 'Unknown user',
    entityType: row.entityType,
    ...(row.entityId ? { entityId: row.entityId.toString() } : {}),
    entityLabel: row.entityLabel,
    action: row.action,
    ...(row.changes && row.changes.length > 0 ? { changes: row.changes } : {}),
    ...(row.ip ? { ip: row.ip } : {}),
    createdAt: row.createdAt.toISOString(),
  };
}
