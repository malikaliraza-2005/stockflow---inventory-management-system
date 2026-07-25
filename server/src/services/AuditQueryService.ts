/**
 * AuditQueryService — the READ side of the audit trail (F7 P5 slice,
 * FR-TXN-04/05). Deliberately SEPARATE from AuditService: that service is
 * insert-only by architectural contract (DES-1, DBD §6.2 — no read/update/delete
 * may be added there), so the query path lives in its own read-only class rather
 * than widening the writer's surface.
 *
 * Lists audit rows for the Admin Audit Trail tab, resolving each row's actor
 * display name. Rows surface entity diffs AND security events (both live in the
 * same collection). `entityLabel` (DN-4) is captured at write time, so a row
 * renders even after its entity is hard-deleted. Plans ride the DBD §2.6 R-5
 * indexes: `{entityType,createdAt}` / `{actorId,createdAt}` / `{entityId,createdAt}`.
 */
import { Types, type FilterQuery } from 'mongoose';

import { listEnvelope, type ListEnvelope } from '../lib/pagination.js';
import { AuditLog, type AuditLogDoc } from '../models/AuditLog.js';
import { User } from '../models/User.js';
import {
  serializeAuditLogRow,
  type AuditLogLean,
  type AuditLogRowPayload,
} from '../serializers/auditLog.js';
import type { AuditLogsQuery } from '../validation/schemas/auditLogs.js';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class AuditQueryService {
  async list(query: AuditLogsQuery): Promise<ListEnvelope<AuditLogRowPayload>> {
    const filter = buildFilter(query);
    const skip = (query.page - 1) * query.limit;

    const [rows, totalItems] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit).lean(),
      AuditLog.countDocuments(filter),
    ]);

    const actors = await resolveActors(rows);
    return listEnvelope(
      (rows as AuditLogLean[]).map((row) =>
        serializeAuditLogRow(row, actors.get(row.actorId.toString())),
      ),
      query.page,
      query.limit,
      totalItems,
    );
  }
}

function buildFilter(query: AuditLogsQuery): FilterQuery<AuditLogDoc> {
  const filter: FilterQuery<AuditLogDoc> = {};
  if (query.entityType) filter.entityType = query.entityType;
  if (query.entityId) filter.entityId = new Types.ObjectId(query.entityId);
  if (query.actorId) filter.actorId = new Types.ObjectId(query.actorId);
  if (query.from || query.to) {
    const createdAt: Record<string, Date> = {};
    if (query.from) createdAt.$gte = new Date(query.from);
    if (query.to) createdAt.$lte = endOfRange(query.to);
    filter.createdAt = createdAt;
  }
  return filter;
}

async function resolveActors(rows: Pick<AuditLogDoc, 'actorId'>[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((r) => r.actorId.toString()))];
  const users = await User.find({ _id: { $in: ids } })
    .select('name')
    .lean();
  return new Map(users.map((u) => [u._id.toString(), u.name]));
}

/** Inclusive end — a date-only `to` covers its whole UTC day. */
function endOfRange(to: string): Date {
  return DATE_ONLY.test(to) ? new Date(`${to}T23:59:59.999Z`) : new Date(to);
}
