/**
 * AuditService — FR-TXN-04/05. F1 slice (IMP-020 review Issue 2): the
 * insert-only writer core + the SECURITY-EVENT path, landing with its first
 * consumer (AuthService needs LOGIN_FAILED / LOCKOUT / TOKEN_REUSE_DETECTED
 * for its own acceptance suite).
 *
 * The entity-diff path (`changes[]` computation, DN-4 label capture from
 * documents, sensitive-field exclusion) lands with F2 — user updates are ITS
 * first consumer (PR 1.4).
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
import type { Types } from 'mongoose';

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
   * Append one row — the awaitable core. Later features (T3–T6) call this
   * INSIDE their transaction boundaries; F1's consumers wrap it via
   * `securityEvent`.
   */
  async record(entry: AuditEntry): Promise<void> {
    await AuditLog.create([entry], {});
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
