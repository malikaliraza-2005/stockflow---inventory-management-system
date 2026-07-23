/**
 * AuditService — FR-TXN-04/05. F1 slice (IMP-020 review Issue 2): the
 * insert-only writer core + the SECURITY-EVENT path, landing with its first
 * consumer (AuthService needs LOGIN_FAILED / LOCKOUT / TOKEN_REUSE_DETECTED
 * for its own acceptance suite).
 *
 * F2 adds the entity-diff path (IMP-020 Issue 2, second half): `changes[]`
 * computation with a sensitive-field denylist, DN-4 label capture, and
 * transaction-session support so audit rows commit ATOMICALLY inside their
 * T3–T6 boundaries — user updates are the first consumer.
 *
 * Contract (DBD §6.2 — DES-1): INSERT-ONLY. This service exposes no update
 * or delete operation, and none may ever be added without architecture
 * review.
 *
 * Security events are FIRE-AND-FORGET (AAD §7): they never block and never
 * fail the request path — a write failure degrades to a `warn` log (the
 * request outcome is already correct; losing one event row is preferable to
 * failing a login because the audit insert hiccuped).
 */
import type { Logger } from '../lib/logger.js';
import {
  AuditLog,
  type AuditAction,
  type AuditChange,
  type AuditEntityType,
} from '../models/AuditLog.js';
import type { ClientSession, Types } from 'mongoose';

/**
 * NEVER diffed (DBD §2.6): credential and token material must not appear in
 * audit rows even as "changed" markers.
 */
export const SENSITIVE_AUDIT_FIELDS: ReadonlySet<string> = new Set([
  'passwordHash',
  'resetTokenHash',
  'resetTokenExpiresAt',
  'tokenHash',
]);

export interface AuditEntry {
  actorId: Types.ObjectId | string;
  entityType: AuditEntityType;
  entityId?: Types.ObjectId | string | undefined;
  action: AuditAction;
  /** DN-4: display identity captured at write time (user email, etc.). */
  entityLabel: string;
  changes?: AuditChange[] | undefined;
  ip?: string | undefined;
}

export class AuditService {
  constructor(private readonly logger: Logger) {}

  /**
   * Append one row — the awaitable core. T3–T6 call this INSIDE their
   * transaction boundaries (pass the session — the audit row commits or
   * aborts WITH the change it describes); F1's consumers wrap it via
   * `securityEvent`.
   */
  async record(
    entry: AuditEntry,
    options: { session?: ClientSession | undefined } = {},
  ): Promise<void> {
    await AuditLog.create([entry], { session: options.session });
  }

  /**
   * The diff path (DN-4): field-by-field before/after over an explicit field
   * list; unchanged fields are omitted; sensitive fields are NEVER diffed
   * (silently dropped even if listed — defense against a careless caller).
   */
  static computeChanges(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    fields: readonly string[],
  ): AuditChange[] {
    const changes: AuditChange[] = [];
    for (const field of fields) {
      if (SENSITIVE_AUDIT_FIELDS.has(field)) continue;
      const prev = before[field];
      const next = after[field];
      if (prev === next || next === undefined) continue;
      changes.push({ field, before: prev, after: next });
    }
    return changes;
  }

  /**
   * AAD §7 security-event path — fire-and-forget. Callers `void` the returned
   * promise (it exists so tests can await determinism); it NEVER rejects.
   */
  securityEvent(entry: AuditEntry): Promise<void> {
    return this.record(entry).catch((error: unknown) => {
      this.logger.warn(
        { err: error, action: entry.action, entityType: entry.entityType },
        'security event write failed (fire-and-forget — request unaffected)',
      );
    });
  }
}
