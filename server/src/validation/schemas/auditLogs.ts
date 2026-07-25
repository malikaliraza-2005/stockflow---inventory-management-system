/**
 * Audit-logs query schema — VAL §5 "Audit logs" (F7 P5 slice); GET /audit-logs
 * (05 §7.6, Admin). Read-only: the audit trail is append-only (DES-1), so there
 * is no write schema. Filters mirror the R-5 index set — entity type / entity /
 * actor / ordered date range — so every combination rides an index (no COLLSCAN).
 *
 * The API contract (05 §7.6) defines exactly these params; the WIR §11 "Action"
 * dropdown has no server filter (§9.3 adds no param), so action is not a query
 * field here.
 */
import { z } from 'zod';

import { AUDIT_ENTITY_TYPES } from '../../models/AuditLog.js';
import { isoDate, objectId } from '../primitives.js';

export const auditLogsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20), // NFR-10
    entityType: z.enum(AUDIT_ENTITY_TYPES).optional(),
    entityId: objectId.optional(),
    actorId: objectId.optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.from && value.to && new Date(value.from) > new Date(value.to)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'The start date must be on or before the end date',
        path: ['to'],
      });
    }
  });

export type AuditLogsQuery = z.infer<typeof auditLogsQuerySchema>;
