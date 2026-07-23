/**
 * AuthService — BR-32…35 (BEA §4), mechanics per AAD §2–§4/§6.
 *
 * Design commitments encoded here:
 *
 *  - FAIL CLOSED (AAD §1): every ambiguous state → re-authenticate. The
 *    rotation order is mark-old-FIRST, insert-new-second (BEV-02): a crash
 *    between the two makes the next refresh trip reuse detection → family
 *    revoked → re-login. Deliberately NO transaction around rotation.
 *  - GENERIC login errors (AAD §2): unknown email and wrong password return
 *    the identical 401; unknown emails burn one bcrypt compare against a
 *    dummy hash so both paths cost the same (timing/enumeration defense).
 *    The dummy hash is generated at construction AT THE CONFIGURED COST so
 *    the defense is real in prod (cost 12) and measurable in tests.
 *  - Lockout (BR-33) is DB-backed — the global authority across instances.
 *    The clock is injected so the 15-minute window is testable. The counter
 *    keeps incrementing past the threshold: a failure after lock expiry
 *    re-locks immediately (still "consecutive" — only success resets).
 *  - Security events are fire-and-forget (`void` — AAD §7); LOGIN_FAILED is
 *    recorded for KNOWN accounts only: auditLogs.actorId is required
 *    (DBD §2.6) and unauthenticated probes of unknown emails must not be able
 *    to flood the audit trail.
 *  - Token validity is ALWAYS checked by value (PDV-03) — the TTL index is
 *    garbage collection, never a boundary.
 */
import bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import type { HydratedDocument, Types } from 'mongoose';

import {
  AccountDeactivatedError,
  AccountLockedError,
  NotFoundError,
  UnauthorizedError,
  AppError,
} from '../errors/AppError.js';
import type { Logger } from '../lib/logger.js';
import {
  generateOpaqueToken,
  hashToken,
  newFamilyId,
  signAccessToken,
  durationToMs,
} from '../lib/tokens.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { User, type UserDoc } from '../models/User.js';
import type { AuditService } from './AuditService.js';

const BCRYPT_COST = 12; // BR-32
const LOCKOUT_THRESHOLD = 5; // BR-33
const LOCKOUT_MS = 15 * 60_000; // BR-33
const RESET_TOKEN_MS = 30 * 60_000; // AAD §2 reset flow

/** One string for both unknown-email and wrong-password (AAD §2 — generic). */
const GENERIC_LOGIN_MESSAGE = 'Invalid email or password.';
const RESET_TOKEN_MESSAGE = 'Reset link is invalid or has expired.';

export interface AuthServiceDeps {
  audit: AuditService;
  logger: Logger;
  config: {
    accessSecret: string;
    accessTtl: string; // '15m'
    refreshTtl: string; // '7d'
  };
  /** Injected clock — the lockout window is tested by advancing this. */
  now?: () => Date;
  /** Test seam only — production uses the BR-32 cost 12 default. */
  bcryptCost?: number;
}

export interface RequestContext {
  ip?: string;
  userAgent?: string;
}

export interface AuthSession {
  accessToken: string;
  /** RAW opaque token — travels only in the httpOnly cookie; never stored, never logged. */
  refreshToken: string;
  refreshExpiresAt: Date;
  user: HydratedDocument<UserDoc>;
}

/**
 * Revoke refresh sessions for a user — the §3.3 matrix workhorse, exported
 * standalone so F2's T6 boundary (UserService) can call it inside its own
 * transaction without owning an AuthService.
 */
export async function revokeSessions(
  userId: Types.ObjectId | string,
  options: { exceptTokenHash?: string | undefined; now?: Date | undefined } = {},
): Promise<void> {
  const filter: Record<string, unknown> = { userId, revokedAt: null };
  if (options.exceptTokenHash) filter.tokenHash = { $ne: options.exceptTokenHash };
  await RefreshToken.updateMany(filter, { $set: { revokedAt: options.now ?? new Date() } });
}

export class AuthService {
  private readonly audit: AuditService;
  private readonly logger: Logger;
  private readonly config: AuthServiceDeps['config'];
  private readonly now: () => Date;
  private readonly bcryptCost: number;
  /** AAD §2 enumeration defense — same cost as real hashes, unknowable input. */
  private readonly dummyHash: string;

  constructor(deps: AuthServiceDeps) {
    this.audit = deps.audit;
    this.logger = deps.logger;
    this.config = deps.config;
    this.now = deps.now ?? (() => new Date());
    this.bcryptCost = deps.bcryptCost ?? BCRYPT_COST;
    this.dummyHash = bcrypt.hashSync(randomBytes(32).toString('hex'), this.bcryptCost);
  }

  /** Login (UC-01): lockout check → bcrypt verify → counter/events → session. */
  async login(email: string, password: string, ctx: RequestContext = {}): Promise<AuthSession> {
    const user = await User.findOne({ email }).select('+passwordHash');

    if (!user) {
      // Unknown email: burn the SAME bcrypt work as the known-email path,
      // then the SAME generic error — no timing or wording side-channel.
      await bcrypt.compare(password, this.dummyHash);
      throw new UnauthorizedError(GENERIC_LOGIN_MESSAGE);
    }

    // BR-33 — by VALUE, before any bcrypt work (AAD §4 order).
    if (user.lockedUntil && user.lockedUntil > this.now()) {
      throw new AccountLockedError();
    }

    const passwordOk = await bcrypt.compare(password, user.passwordHash);
    if (!passwordOk) {
      await this.registerLoginFailure(user, ctx);
      throw new UnauthorizedError(GENERIC_LOGIN_MESSAGE);
    }

    // AFTER verification — a caller without valid credentials learns nothing
    // about account status (login's ACCOUNT_DEACTIVATED requires the password).
    if (!user.isActive) {
      throw new AccountDeactivatedError();
    }

    const loginAt = this.now();
    await User.updateOne(
      { _id: user._id },
      { $set: { failedLoginCount: 0, lastLoginAt: loginAt }, $unset: { lockedUntil: '' } },
    );

    void this.audit.securityEvent({
      actorId: user._id,
      entityType: 'SECURITY',
      entityId: user._id,
      action: 'LOGIN_SUCCESS',
      entityLabel: user.email,
      ip: ctx.ip,
    });

    return this.issueSession(user, newFamilyId(), ctx);
  }

  /**
   * Silent refresh (ARB-03 server side): rotate on every use; reuse of a
   * rotated/revoked token revokes the ENTIRE family (BR-35).
   */
  async refresh(rawToken: string | undefined, ctx: RequestContext = {}): Promise<AuthSession> {
    if (!rawToken) throw new UnauthorizedError();

    const row = await RefreshToken.findOne({ tokenHash: hashToken(rawToken) });
    if (!row) throw new UnauthorizedError();

    if (row.rotatedAt || row.revokedAt) {
      // Reuse detected — theft, or a crash mid-rotation (BEV-02). Both are
      // ambiguous states, both fail closed: kill the family, force re-login.
      const at = this.now();
      await RefreshToken.updateMany(
        { familyId: row.familyId, revokedAt: null },
        { $set: { revokedAt: at } },
      );
      const user = await User.findById(row.userId);
      void this.audit.securityEvent({
        actorId: row.userId,
        entityType: 'SECURITY',
        entityId: row.userId,
        action: 'TOKEN_REUSE_DETECTED',
        entityLabel: user?.email ?? row.userId.toString(),
        ip: ctx.ip,
      });
      throw new UnauthorizedError();
    }

    // PDV-03: expiry by VALUE — the TTL index may not have collected yet.
    if (row.expiresAt <= this.now()) throw new UnauthorizedError();

    const user = await User.findById(row.userId);
    if (!user || !user.isActive) {
      await RefreshToken.updateOne({ _id: row._id }, { $set: { revokedAt: this.now() } });
      throw new UnauthorizedError();
    }

    // Rotation, fail-closed order (BEV-02): mark FIRST, insert SECOND.
    await RefreshToken.updateOne({ _id: row._id }, { $set: { rotatedAt: this.now() } });
    return this.issueSession(user, row.familyId, ctx);
  }

  /** Logout — idempotent (AAD §3.3): unknown/already-revoked still succeeds. */
  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    await RefreshToken.updateOne(
      { tokenHash: hashToken(rawToken), revokedAt: null },
      { $set: { revokedAt: this.now() } },
    );
  }

  /**
   * Admin-initiated reset issue (UC-03) — single-use token, 30-min expiry,
   * stored HASHED (DBR-04); all target sessions revoked AT ISSUE. Returns the
   * raw token for out-of-band link delivery (AS-6) — the route (F2) owns
   * link assembly.
   */
  async issueReset(
    targetUserId: string,
    actorId: Types.ObjectId | string,
    ctx: RequestContext = {},
  ): Promise<{ token: string; expiresAt: Date }> {
    const target = await User.findById(targetUserId);
    if (!target) throw new NotFoundError('User not found.');
    if (!target.isActive) {
      // VAL §5: inactive target → 400 (an explicit operator mistake, not a 404)
      throw new AppError('VALIDATION_ERROR', 'Cannot reset a deactivated account.');
    }

    const token = generateOpaqueToken();
    const expiresAt = new Date(this.now().getTime() + RESET_TOKEN_MS);
    await User.updateOne(
      { _id: target._id },
      { $set: { resetTokenHash: hashToken(token), resetTokenExpiresAt: expiresAt } },
    );
    await revokeSessions(target._id, { now: this.now() });

    void this.audit.securityEvent({
      actorId,
      entityType: 'SECURITY',
      entityId: target._id,
      action: 'PASSWORD_RESET_ISSUED',
      entityLabel: target.email,
      ip: ctx.ip,
    });

    return { token, expiresAt };
  }

  /**
   * Reset completion (UC-03): hash-indexed lookup (timing-safe by
   * construction — DBR-04), expiry by value, single-use regardless of
   * outcome. Clears `mustChangePassword` (the user just chose a password).
   */
  async completeReset(
    rawToken: string,
    newPassword: string,
    ctx: RequestContext = {},
  ): Promise<void> {
    const user = await User.findOne({ resetTokenHash: hashToken(rawToken) });
    if (!user || !user.resetTokenExpiresAt || user.resetTokenExpiresAt <= this.now()) {
      throw new UnauthorizedError(RESET_TOKEN_MESSAGE);
    }

    const passwordHash = await bcrypt.hash(newPassword, this.bcryptCost);
    await User.updateOne(
      { _id: user._id },
      {
        $set: { passwordHash, mustChangePassword: false, failedLoginCount: 0 },
        $unset: { resetTokenHash: '', resetTokenExpiresAt: '', lockedUntil: '' },
      },
    );
    // Sessions created between issue and completion (old password still worked
    // until now) die here — the §3.3 matrix row is "all prior sessions".
    await revokeSessions(user._id, { now: this.now() });

    void this.audit.securityEvent({
      actorId: user._id,
      entityType: 'SECURITY',
      entityId: user._id,
      action: 'PASSWORD_RESET_COMPLETED',
      entityLabel: user.email,
      ip: ctx.ip,
    });
  }

  /**
   * Own password change: current password verified; revokes all OTHER
   * sessions (the presented refresh token survives — AAD §3.3).
   */
  async changePassword(
    userId: Types.ObjectId | string,
    currentPassword: string,
    newPassword: string,
    options: { currentTokenHash?: string } & RequestContext = {},
  ): Promise<void> {
    const user = await User.findById(userId).select('+passwordHash');
    if (!user) throw new UnauthorizedError();

    const currentOk = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!currentOk) throw new UnauthorizedError('Current password is incorrect.');

    const passwordHash = await bcrypt.hash(newPassword, this.bcryptCost);
    await User.updateOne({ _id: user._id }, { $set: { passwordHash, mustChangePassword: false } });
    await revokeSessions(user._id, {
      exceptTokenHash: options.currentTokenHash,
      now: this.now(),
    });

    void this.audit.securityEvent({
      actorId: user._id,
      entityType: 'SECURITY',
      entityId: user._id,
      action: 'PASSWORD_CHANGED',
      entityLabel: user.email,
      ip: options.ip,
    });
  }

  // ── internals ──────────────────────────────────────────────────────────

  /** Failure bookkeeping (BR-33): atomic $inc (concurrent failures both count). */
  private async registerLoginFailure(
    user: HydratedDocument<UserDoc>,
    ctx: RequestContext,
  ): Promise<void> {
    const updated = await User.findOneAndUpdate(
      { _id: user._id },
      { $inc: { failedLoginCount: 1 } },
      { new: true },
    );
    const count = updated?.failedLoginCount ?? 0;

    if (count >= LOCKOUT_THRESHOLD) {
      const lockedUntil = new Date(this.now().getTime() + LOCKOUT_MS);
      await User.updateOne({ _id: user._id }, { $set: { lockedUntil } });
      void this.audit.securityEvent({
        actorId: user._id,
        entityType: 'SECURITY',
        entityId: user._id,
        action: 'LOCKOUT',
        entityLabel: user.email,
        ip: ctx.ip,
      });
    }

    void this.audit.securityEvent({
      actorId: user._id,
      entityType: 'SECURITY',
      entityId: user._id,
      action: 'LOGIN_FAILED',
      entityLabel: user.email,
      ip: ctx.ip,
    });
  }

  /** Mint the access token + persist a new session row (same family on rotation). */
  private async issueSession(
    user: HydratedDocument<UserDoc>,
    familyId: string,
    ctx: RequestContext,
  ): Promise<AuthSession> {
    const refreshToken = generateOpaqueToken();
    const refreshExpiresAt = new Date(this.now().getTime() + durationToMs(this.config.refreshTtl));

    await RefreshToken.create({
      userId: user._id,
      tokenHash: hashToken(refreshToken),
      familyId,
      expiresAt: refreshExpiresAt,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    const accessToken = signAccessToken(
      { sub: user._id.toString(), role: user.role },
      this.config.accessSecret,
      this.config.accessTtl,
    );

    return { accessToken, refreshToken, refreshExpiresAt, user };
  }
}
