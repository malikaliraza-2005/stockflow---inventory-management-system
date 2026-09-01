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
import mongoose, { type HydratedDocument, type Types } from 'mongoose';

import {
  AccountDeactivatedError,
  AccountLockedError,
  DuplicateEmailError,
  NotFoundError,
  UnauthorizedError,
  AppError,
} from '../errors/AppError.js';
import type { GoogleVerifier } from '../lib/googleVerify.js';
import type { Logger } from '../lib/logger.js';
import { runAsSystem, runWithTenant } from '../lib/tenantContext.js';
import {
  generateOpaqueToken,
  hashToken,
  newFamilyId,
  signAccessToken,
  durationToMs,
} from '../lib/tokens.js';
import { Organization } from '../models/Organization.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { Settings } from '../models/Settings.js';
import { User, type UserDoc } from '../models/User.js';
import type { AuditService } from './AuditService.js';
import { provisionTenant, type ProvisionTenantInput } from './provisioning.js';
import type { SignupInput } from '../validation/schemas/auth.js';

const BCRYPT_COST = 12; // BR-32
const LOCKOUT_THRESHOLD = 5; // BR-33
const LOCKOUT_MS = 15 * 60_000; // BR-33
const RESET_TOKEN_MS = 30 * 60_000; // AAD §2 reset flow
/**
 * BR-35 concurrency grace: how long after rotation the SAME token may still be
 * presented before it counts as reuse. Covers only genuine simultaneity (two
 * tabs, a retried request) — a stolen token replayed later than this still
 * kills the family, and a revoked token is never in grace.
 */
const ROTATION_GRACE_MS = 10_000;
const MONGO_DUPLICATE_KEY = 11000;

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
  /** Google ID-token verifier (google-auth-library). Absent ⇒ Google sign-in
   *  is not configured on this instance. Injected so unit tests stub identity. */
  verifyGoogleToken?: GoogleVerifier | undefined;
}

export interface RequestContext {
  ip?: string | undefined;
  userAgent?: string | undefined;
}

/**
 * FCM-01 (RATIFIED 2026-07-23): read-only display constants carried by the
 * login/refresh payload — Staff has no other approved endpoint for them (the
 * §5 matrix keeps GET /settings Admin-only). Additive, EXT-01-compliant;
 * exposes no settings management.
 */
export interface SessionSettings {
  systemCurrency: string;
  movementWarningThreshold: number;
}

export interface AuthSession {
  accessToken: string;
  /** RAW opaque token — travels only in the httpOnly cookie; never stored, never logged. */
  refreshToken: string;
  refreshExpiresAt: Date;
  user: HydratedDocument<UserDoc>;
  settings: SessionSettings;
}

/**
 * Revoke refresh sessions for a user — the §3.3 matrix workhorse, exported
 * standalone so F2's T6 boundary (UserService) can call it inside its own
 * transaction without owning an AuthService.
 */
export async function revokeSessions(
  userId: Types.ObjectId | string,
  options: {
    exceptTokenHash?: string | undefined;
    now?: Date | undefined;
    /** T6 passes its session so revocation commits atomically (DBD §4). */
    session?: import('mongoose').ClientSession | undefined;
  } = {},
): Promise<void> {
  const filter: Record<string, unknown> = { userId, revokedAt: null };
  if (options.exceptTokenHash) filter.tokenHash = { $ne: options.exceptTokenHash };
  let query = RefreshToken.updateMany(filter, {
    $set: { revokedAt: options.now ?? new Date() },
  });
  if (options.session) query = query.session(options.session);
  await query;
}

export class AuthService {
  private readonly audit: AuditService;
  private readonly logger: Logger;
  private readonly config: AuthServiceDeps['config'];
  private readonly now: () => Date;
  private readonly bcryptCost: number;
  private readonly verifyGoogleToken: GoogleVerifier | undefined;
  /** AAD §2 enumeration defense — same cost as real hashes, unknowable input. */
  private readonly dummyHash: string;

  constructor(deps: AuthServiceDeps) {
    this.audit = deps.audit;
    this.logger = deps.logger;
    this.config = deps.config;
    this.now = deps.now ?? (() => new Date());
    this.bcryptCost = deps.bcryptCost ?? BCRYPT_COST;
    this.verifyGoogleToken = deps.verifyGoogleToken;
    this.dummyHash = bcrypt.hashSync(randomBytes(32).toString('hex'), this.bcryptCost);
  }

  /**
   * Public self-service signup (SaaS): provision a NEW tenant + its first Admin
   * atomically, then auto-log-in. Email is globally unique — a collision (in
   * ANY tenant) is a 409. Runs pre-auth, so tenant-owned writes open their own
   * (brand-new) tenant context inside `provisionTenant`.
   */
  async signup(input: SignupInput, ctx: RequestContext = {}): Promise<AuthSession> {
    const passwordHash = await bcrypt.hash(input.password, this.bcryptCost);
    const user = await this.provisionAccount({
      organizationName: input.organizationName,
      adminName: input.name,
      adminEmail: input.email,
      adminPasswordHash: passwordHash,
      mustChangePassword: false, // they just chose this password
    });

    // Auto-login the new owner (session issued tenant-scoped).
    return runWithTenant(user.tenantId, () => {
      void this.audit.securityEvent({
        actorId: user._id,
        entityType: 'SECURITY',
        entityId: user._id,
        action: 'LOGIN_SUCCESS',
        entityLabel: user.email,
        ip: ctx.ip,
      });
      return this.issueSession(user, newFamilyId(), ctx);
    });
  }

  /**
   * Google sign-in (GIS ID-token flow, both "Login" and "Sign up" buttons hit
   * this). Verify the token, then resolve-or-provision by VERIFIED email — the
   * global-unique email means one Google identity maps to exactly one account:
   *
   *  - email matches an existing account → auto-LINK (attach googleSub) + login;
   *  - no match → provision a brand-new, password-less workspace they own.
   *
   * Unverified Google email is rejected (linking by email requires Google's
   * `email_verified` assertion — otherwise an attacker could claim any address).
   */
  async loginWithGoogle(idToken: string, ctx: RequestContext = {}): Promise<AuthSession> {
    if (!this.verifyGoogleToken) {
      throw new AppError('VALIDATION_ERROR', 'Google sign-in is not available.');
    }
    const identity = await this.verifyGoogleToken(idToken);
    if (!identity.emailVerified) {
      throw new UnauthorizedError('Your Google account email is not verified.');
    }
    const email = identity.email.toLowerCase();

    // Resolve across tenants in system context (email is global) — mirrors login.
    const existing = await runAsSystem(() => User.findOne({ email }));
    if (existing) {
      return runWithTenant(existing.tenantId, async () => {
        if (!existing.isActive) throw new AccountDeactivatedError();
        // Auto-link the Google identity (idempotent) and clear any lock/failures.
        await User.updateOne(
          { _id: existing._id },
          {
            $set: { googleSub: identity.sub, lastLoginAt: this.now(), failedLoginCount: 0 },
            $unset: { lockedUntil: '' },
          },
        );
        void this.audit.securityEvent({
          actorId: existing._id,
          entityType: 'SECURITY',
          entityId: existing._id,
          action: 'LOGIN_SUCCESS',
          entityLabel: existing.email,
          ip: ctx.ip,
        });
        return this.issueSession(existing, newFamilyId(), ctx);
      });
    }

    // First-time Google user — a fresh workspace they own (no password).
    let displayName = identity.name?.trim() || email.split('@')[0] || 'New User';
    if (displayName.length < 2) displayName = 'New User';
    displayName = displayName.slice(0, 80);
    const user = await this.provisionAccount({
      organizationName: `${displayName}'s Workspace`.slice(0, 120),
      adminName: displayName,
      adminEmail: email,
      authProvider: 'GOOGLE',
      googleSub: identity.sub,
    });
    return runWithTenant(user.tenantId, () => {
      void this.audit.securityEvent({
        actorId: user._id,
        entityType: 'SECURITY',
        entityId: user._id,
        action: 'LOGIN_SUCCESS',
        entityLabel: user.email,
        ip: ctx.ip,
      });
      return this.issueSession(user, newFamilyId(), ctx);
    });
  }

  /** Login (UC-01): lockout check → bcrypt verify → counter/events → session. */
  async login(email: string, password: string, ctx: RequestContext = {}): Promise<AuthSession> {
    // Email is GLOBALLY unique (SaaS) — resolve the account across all tenants
    // in system context, BEFORE any tenant is known.
    const user = await runAsSystem(() => User.findOne({ email }).select('+passwordHash'));

    if (!user) {
      // Unknown email: burn the SAME bcrypt work as the known-email path,
      // then the SAME generic error — no timing or wording side-channel.
      await bcrypt.compare(password, this.dummyHash);
      throw new UnauthorizedError(GENERIC_LOGIN_MESSAGE);
    }

    // The tenant is now known — everything that reads/writes tenant-owned data
    // (failure bookkeeping, audit, session settings) runs tenant-scoped.
    return runWithTenant(user.tenantId, async () => {
      // BR-33 — by VALUE, before any bcrypt work (AAD §4 order).
      if (user.lockedUntil && user.lockedUntil > this.now()) {
        throw new AccountLockedError();
      }

      // A Google-only account has no password — treat a password login as a
      // generic failure, burning the SAME bcrypt work (no timing/wording tell).
      if (!user.passwordHash) {
        await bcrypt.compare(password, this.dummyHash);
        throw new UnauthorizedError(GENERIC_LOGIN_MESSAGE);
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
    });
  }

  /**
   * Silent refresh (ARB-03 server side): rotate on every use; reuse of a
   * rotated/revoked token revokes the ENTIRE family (BR-35).
   */
  async refresh(rawToken: string | undefined, ctx: RequestContext = {}): Promise<AuthSession> {
    if (!rawToken) throw new UnauthorizedError();

    const row = await RefreshToken.findOne({ tokenHash: hashToken(rawToken) });
    if (!row) throw new UnauthorizedError();

    // Concurrency grace (BR-35 refinement): a browser can legitimately present
    // the SAME cookie twice at once — two tabs restoring together, a retried
    // request, a StrictMode double-mount. Those arrive within milliseconds of
    // each other, so a token whose rotation is still seconds old is a benign
    // duplicate, not theft: re-issue into the same family instead of revoking
    // it. A revoked token is never benign, and the window is measured from the
    // FIRST rotation (never re-stamped) so a replay cannot extend it.
    const rotatedAgeMs = row.rotatedAt ? this.now().getTime() - row.rotatedAt.getTime() : null;
    const concurrentUse =
      !row.revokedAt && rotatedAgeMs !== null && rotatedAgeMs <= ROTATION_GRACE_MS;

    if ((row.rotatedAt || row.revokedAt) && !concurrentUse) {
      // Reuse detected — theft, or a crash mid-rotation (BEV-02). Both are
      // ambiguous states, both fail closed: kill the family, force re-login.
      const at = this.now();
      await RefreshToken.updateMany(
        { familyId: row.familyId, revokedAt: null },
        { $set: { revokedAt: at } },
      );
      const user = await runAsSystem(() => User.findById(row.userId));
      // The security event is tenant-owned — write it in the actor's tenant
      // (accounts are permanent per BR-29, so the user is expected to exist).
      if (user) {
        await runWithTenant(user.tenantId, () =>
          this.audit.securityEvent({
            actorId: row.userId,
            entityType: 'SECURITY',
            entityId: row.userId,
            action: 'TOKEN_REUSE_DETECTED',
            entityLabel: user.email,
            ip: ctx.ip,
          }),
        );
      }
      throw new UnauthorizedError();
    }

    // PDV-03: expiry by VALUE — the TTL index may not have collected yet.
    if (row.expiresAt <= this.now()) throw new UnauthorizedError();

    const user = await runAsSystem(() => User.findById(row.userId));
    if (!user || !user.isActive) {
      await RefreshToken.updateOne({ _id: row._id }, { $set: { revokedAt: this.now() } });
      throw new UnauthorizedError();
    }

    // Rotation, fail-closed order (BEV-02): mark FIRST, insert SECOND. Already
    // marked ⇒ this is the grace path above; leave the original stamp alone.
    if (!row.rotatedAt) {
      await RefreshToken.updateOne({ _id: row._id }, { $set: { rotatedAt: this.now() } });
    }
    return runWithTenant(user.tenantId, () => this.issueSession(user, row.familyId, ctx));
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
    // Reset token is globally unique (hash-indexed) — resolve the account in
    // system context, then complete the reset scoped to its tenant.
    const user = await runAsSystem(() => User.findOne({ resetTokenHash: hashToken(rawToken) }));
    if (!user || !user.resetTokenExpiresAt || user.resetTokenExpiresAt <= this.now()) {
      throw new UnauthorizedError(RESET_TOKEN_MESSAGE);
    }

    await runWithTenant(user.tenantId, async () => {
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
    options: { currentTokenHash?: string | undefined } & RequestContext = {},
  ): Promise<void> {
    const user = await User.findById(userId).select('+passwordHash');
    if (!user) throw new UnauthorizedError();
    if (!user.passwordHash) {
      throw new AppError(
        'VALIDATION_ERROR',
        'This account signs in with Google and has no password to change.',
      );
    }

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

  /** URL-safe handle from a workspace name; empty input falls back to "workspace". */
  private slugify(name: string): string {
    const base = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120);
    return base || 'workspace';
  }

  /** A slug not currently taken (the unique index is the real backstop under races). */
  private async uniqueSlug(name: string): Promise<string> {
    const base = this.slugify(name);
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = attempt === 0 ? base : `${base}-${randomBytes(3).toString('hex')}`;
      const exists = await runAsSystem(() => Organization.exists({ slug: candidate }));
      if (!exists) return candidate;
    }
    return `${base}-${randomBytes(6).toString('hex')}`;
  }

  /**
   * Provision a new tenant + its owner inside a transaction and return the owner
   * (system-context load). Shared by password signup and password-less Google
   * signup. Email uniqueness is enforced by the index — a race surfaces as
   * DuplicateEmailError; a slug race is a transient retryable 400.
   */
  private async provisionAccount(
    input: Omit<ProvisionTenantInput, 'slug'>,
  ): Promise<HydratedDocument<UserDoc>> {
    const slug = await this.uniqueSlug(input.organizationName);
    let userId: Types.ObjectId | undefined;
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(
        async () => {
          const provisioned = await provisionTenant({ ...input, slug }, { session });
          userId = provisioned.userId;
        },
        { readConcern: { level: 'majority' }, writeConcern: { w: 'majority' } },
      );
    } catch (error) {
      if ((error as { code?: number }).code === MONGO_DUPLICATE_KEY) {
        const keyPattern = (error as { keyPattern?: Record<string, unknown> }).keyPattern ?? {};
        if ('email' in keyPattern) throw new DuplicateEmailError(); // one email = one account
        // Slug race (rare) — a transient collision; the client may retry.
        throw new AppError(
          'VALIDATION_ERROR',
          'Could not create the workspace — please try again.',
        );
      }
      throw error;
    } finally {
      await session.endSession();
    }

    const user = await runAsSystem(() => User.findById(userId));
    if (!user) throw new UnauthorizedError();
    return user;
  }

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

    // FCM-01: the tenant's settings doc (created at signup/seed; the fallback
    // keeps a mid-migration login from crashing). Explicitly tenant-filtered.
    const settings = await Settings.findOne({ tenantId: user.tenantId });
    return {
      accessToken,
      refreshToken,
      refreshExpiresAt,
      user,
      settings: {
        systemCurrency: settings?.currency ?? 'USD',
        movementWarningThreshold: settings?.movementWarningThreshold ?? 1000,
      },
    };
  }
}
