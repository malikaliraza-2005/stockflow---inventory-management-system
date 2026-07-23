/**
 * `auditLogs` — DBD §2.6, 1:1. Append-only record of who changed non-stock
 * state (entity diffs) plus security events (AAD §7). ∎ DES-1:
 *
 *  - NO update/delete code path may exist for this model (DBD §6.2 — the
 *    service layer exposes insert-only operations; any diff touching this
 *    model's write paths needs architecture sign-off).
 *  - NO `updatedAt` — the JSON-schema validator additionally REJECTS its
 *    presence (DBD §6.3), so even a buggy native write cannot add one.
 *
 * `entityLabel` (DN-4/ERB-01): display identity captured at write time
 * (product name + SKU / category name / user email) so rows render after
 * hard deletes. Sensitive fields (passwordHash, token hashes) are NEVER
 * diffed — enforced in AuditService, backstopped by review.
 */
import { model, Schema, type Types } from 'mongoose';

export const AUDIT_ENTITY_TYPES = ['PRODUCT', 'CATEGORY', 'USER', 'SETTINGS', 'SECURITY'] as const;
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

/**
 * Closed action set (PDV-01) — additions require a documented review path.
 * REPEATED_FORBIDDEN is a documented extension (F1 T-d): AAD §7 mandates the
 * BEV-03 repeated-403 pattern event but DBD §2.6's enum omitted it — resolved
 * by the same instrument as the APR-01 error-code extensions (delta recorded
 * in 04-Database-Design §2.6).
 */
export const AUDIT_ACTIONS = [
  'CREATE',
  'UPDATE',
  'ARCHIVE',
  'RESTORE',
  'DELETE',
  'LOGIN_SUCCESS',
  'LOGIN_FAILED',
  'LOCKOUT',
  'PASSWORD_RESET_ISSUED',
  'PASSWORD_RESET_COMPLETED',
  'PASSWORD_CHANGED',
  'ROLE_CHANGE',
  'DEACTIVATE',
  'REACTIVATE',
  'TOKEN_REUSE_DETECTED',
  'REPEATED_FORBIDDEN', // BEV-03 pattern event (AAD §7) — documented extension
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** One field diff — money values travel as API strings ("2.10", DBR-05). */
export interface AuditChange {
  field: string;
  before?: unknown;
  after?: unknown;
}

export interface AuditLogDoc {
  actorId: Types.ObjectId;
  entityType: AuditEntityType;
  /** Absent for some security events (e.g., LOGIN_FAILED on unknown email). */
  entityId?: Types.ObjectId;
  action: AuditAction;
  entityLabel: string;
  changes?: AuditChange[];
  ip?: string;
  createdAt: Date;
}

const auditLogSchema = new Schema<AuditLogDoc>(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    entityType: { type: String, required: true, enum: AUDIT_ENTITY_TYPES },
    entityId: { type: Schema.Types.ObjectId },
    action: { type: String, required: true, enum: AUDIT_ACTIONS },
    entityLabel: { type: String, required: true },
    changes: {
      type: [
        new Schema<AuditChange>(
          {
            field: { type: String, required: true },
            before: { type: Schema.Types.Mixed },
            after: { type: Schema.Types.Mixed },
          },
          { _id: false },
        ),
      ],
      default: undefined, // absent, not [] — most security events carry no diff
    },
    ip: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } }, // DES-1: no updatedAt, ever
);

// R-5: cover every /audit-logs filter combination — no COLLSCAN (SCA-02).
auditLogSchema.index({ entityType: 1, createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ entityId: 1, createdAt: -1 });

export const AuditLog = model<AuditLogDoc>('AuditLog', auditLogSchema);
