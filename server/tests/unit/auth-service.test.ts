/**
 * F1 T-c — AuthService vs BR-32…35 (every BR → a named test, IMP-020 T-c) and
 * the AAD §11.5 adversarial classes: lockout sequence, rotation replay,
 * revocation matrix. Clock is INJECTED (the lockout window is tested by
 * advancing it, never by sleeping); bcrypt cost 4 for speed (prod stays 12 —
 * the cost is a constructor seam, BR-32 default).
 */
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AccountDeactivatedError,
  AccountLockedError,
  AppError,
  NotFoundError,
  UnauthorizedError,
} from '../../src/errors/AppError.js';
import { createLogger } from '../../src/lib/logger.js';
import { hashToken, verifyAccessToken } from '../../src/lib/tokens.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { RefreshToken } from '../../src/models/RefreshToken.js';
import { User } from '../../src/models/User.js';
import { AuditService } from '../../src/services/AuditService.js';
import { AuthService } from '../../src/services/AuthService.js';

const SECRET = 'auth-service-test-secret-32-chars!!!';
const PASSWORD = 'correct-h0rse-battery';
const TEST_COST = 4;

let mongod: MongoMemoryServer;
let clock: Date;
const logger = createLogger('error', { write: () => undefined });

function makeService(): AuthService {
  return new AuthService({
    audit: new AuditService(logger),
    logger,
    config: { accessSecret: SECRET, accessTtl: '15m', refreshTtl: '7d' },
    now: () => clock,
    bcryptCost: TEST_COST,
  });
}

function advance(ms: number): void {
  clock = new Date(clock.getTime() + ms);
}

async function createUser(overrides: Partial<Record<string, unknown>> = {}) {
  return User.create({
    name: 'Sara An',
    email: 'sara@example.com',
    passwordHash: bcrypt.hashSync(PASSWORD, TEST_COST),
    role: 'STAFF',
    mustChangePassword: false,
    ...overrides,
  });
}

/** Security events are fire-and-forget — poll until the row lands. */
function pollAudit(action: string) {
  return expect.poll(() => AuditLog.countDocuments({ action }), { timeout: 2000 });
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  clock = new Date('2026-07-23T12:00:00.000Z');
  await Promise.all([User.deleteMany({}), RefreshToken.deleteMany({}), AuditLog.deleteMany({})]);
});

describe('login (UC-01, BR-32/33)', () => {
  it('BR-32__login_issues_session_and_resets_counter', async () => {
    await createUser({ failedLoginCount: 3, lastLoginAt: undefined });
    const service = makeService();

    const session = await service.login('sara@example.com', PASSWORD, { ip: '203.0.113.7' });

    const claims = verifyAccessToken(session.accessToken, SECRET);
    expect(claims.sub).toBe(session.user._id.toString());
    expect(claims.role).toBe('STAFF');

    // Session at rest: HASH only, same family fields as DBD §2.5
    const row = await RefreshToken.findOne({ tokenHash: hashToken(session.refreshToken) });
    expect(row).not.toBeNull();
    expect(row?.familyId).toMatch(/^fam_/);

    const fresh = await User.findById(session.user._id);
    expect(fresh?.failedLoginCount).toBe(0); // BR-33: reset on success
    expect(fresh?.lastLoginAt).toEqual(clock);
    await pollAudit('LOGIN_SUCCESS').toBe(1);
  });

  it('AAD§2__unknown_email_and_wrong_password_are_indistinguishable', async () => {
    await createUser();
    const service = makeService();

    const unknown = await service
      .login('ghost@example.com', PASSWORD)
      .catch((error: unknown) => error);
    const wrongPassword = await service
      .login('sara@example.com', 'wrong-password-9')
      .catch((error: unknown) => error);

    expect(unknown).toBeInstanceOf(UnauthorizedError);
    expect(wrongPassword).toBeInstanceOf(UnauthorizedError);
    expect((unknown as Error).message).toBe((wrongPassword as Error).message); // generic
  });

  it('AAD§2__unknown_email_burns_one_dummy_bcrypt_compare (timing defense)', async () => {
    const service = makeService();
    const compareSpy = vi.spyOn(bcrypt, 'compare');
    await expect(service.login('ghost@example.com', PASSWORD)).rejects.toThrow(UnauthorizedError);
    expect(compareSpy).toHaveBeenCalledTimes(1); // same work as the known path
    compareSpy.mockRestore();
  });

  it('AAD§2__no_audit_row_for_unknown_email (actorId is required; no flooding)', async () => {
    const service = makeService();
    await expect(service.login('ghost@example.com', PASSWORD)).rejects.toThrow();
    // settle any stray fire-and-forget writes before asserting emptiness
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await AuditLog.countDocuments({})).toBe(0);
  });

  it('BR-33__lockout_after_5_consecutive_failures', async () => {
    await createUser();
    const service = makeService();

    for (let i = 0; i < 5; i += 1) {
      await expect(service.login('sara@example.com', 'wrong-password-9')).rejects.toThrow(
        UnauthorizedError, // each failure itself stays generic
      );
    }
    // 6th attempt — even with the CORRECT password — is locked out (423)
    await expect(service.login('sara@example.com', PASSWORD)).rejects.toThrow(AccountLockedError);
    await pollAudit('LOCKOUT').toBe(1);
    await pollAudit('LOGIN_FAILED').toBe(5); // known-account failures recorded
  });

  it('BR-33__lock_expires_by_value_after_15_minutes (injected clock)', async () => {
    await createUser();
    const service = makeService();
    for (let i = 0; i < 5; i += 1) {
      await service.login('sara@example.com', 'wrong-password-9').catch(() => undefined);
    }
    await expect(service.login('sara@example.com', PASSWORD)).rejects.toThrow(AccountLockedError);

    advance(15 * 60_000 + 1000); // the window passes — no sleeping
    const session = await service.login('sara@example.com', PASSWORD);
    expect(session.accessToken).toBeTruthy();
  });

  it('BR-33__failure_after_lock_expiry_relocks_immediately (only success resets)', async () => {
    await createUser();
    const service = makeService();
    for (let i = 0; i < 5; i += 1) {
      await service.login('sara@example.com', 'wrong-password-9').catch(() => undefined);
    }
    advance(15 * 60_000 + 1000);
    await expect(service.login('sara@example.com', 'wrong-password-9')).rejects.toThrow(
      UnauthorizedError,
    );
    // count is now 6 ≥ threshold → re-locked for another window
    await expect(service.login('sara@example.com', PASSWORD)).rejects.toThrow(AccountLockedError);
  });

  it('login__deactivated_account_with_CORRECT_password_gets_ACCOUNT_DEACTIVATED', async () => {
    await createUser({ isActive: false });
    const service = makeService();
    await expect(service.login('sara@example.com', PASSWORD)).rejects.toThrow(
      AccountDeactivatedError,
    );
    // …but with WRONG credentials the caller learns nothing about status
    await expect(service.login('sara@example.com', 'wrong-password-9')).rejects.toThrow(
      UnauthorizedError,
    );
  });
});

describe('refresh & rotation (BR-35, BEV-02, PDV-03)', () => {
  it('BR-35__rotation_issues_new_token_in_same_family_and_retains_old_row', async () => {
    await createUser();
    const service = makeService();
    const first = await service.login('sara@example.com', PASSWORD);
    const second = await service.refresh(first.refreshToken);

    expect(second.refreshToken).not.toBe(first.refreshToken);
    const oldRow = await RefreshToken.findOne({ tokenHash: hashToken(first.refreshToken) });
    const newRow = await RefreshToken.findOne({ tokenHash: hashToken(second.refreshToken) });
    expect(oldRow?.rotatedAt).toEqual(clock); // retained, marked — reuse stays detectable
    expect(oldRow?.familyId).toBe(newRow?.familyId);
  });

  it('BR-35__reuse_of_rotated_token_revokes_entire_family', async () => {
    await createUser();
    const service = makeService();
    const first = await service.login('sara@example.com', PASSWORD);
    const second = await service.refresh(first.refreshToken);

    // Replay the ROTATED token (theft or crash-mid-rotation — BEV-02)
    await expect(service.refresh(first.refreshToken)).rejects.toThrow(UnauthorizedError);
    await pollAudit('TOKEN_REUSE_DETECTED').toBe(1);

    // The whole family is dead — including the latest, still-unexpired token
    await expect(service.refresh(second.refreshToken)).rejects.toThrow(UnauthorizedError);
  });

  it('PDV-03__expiry_checked_by_value_not_by_TTL_collection', async () => {
    await createUser();
    const service = makeService();
    const session = await service.login('sara@example.com', PASSWORD);
    advance(7 * 86_400_000 + 1000); // 7d + 1s — row still physically present
    await expect(service.refresh(session.refreshToken)).rejects.toThrow(UnauthorizedError);
  });

  it('refresh__deactivated_mid_session_fails_closed_and_revokes_token', async () => {
    await createUser();
    const service = makeService();
    const session = await service.login('sara@example.com', PASSWORD);
    await User.updateOne({ email: 'sara@example.com' }, { $set: { isActive: false } });

    await expect(service.refresh(session.refreshToken)).rejects.toThrow(UnauthorizedError);
    const row = await RefreshToken.findOne({ tokenHash: hashToken(session.refreshToken) });
    expect(row?.revokedAt).toEqual(clock);
  });

  it('refresh__missing_or_unknown_token_is_a_plain_401', async () => {
    const service = makeService();
    await expect(service.refresh(undefined)).rejects.toThrow(UnauthorizedError);
    await expect(service.refresh('never-issued-token')).rejects.toThrow(UnauthorizedError);
  });
});

describe('revocation matrix (AAD §3.3 — each row unusable within one request)', () => {
  it('logout__revokes_current_session_and_is_idempotent', async () => {
    await createUser();
    const service = makeService();
    const session = await service.login('sara@example.com', PASSWORD);

    await service.logout(session.refreshToken);
    await expect(service.refresh(session.refreshToken)).rejects.toThrow(UnauthorizedError);

    // Idempotent: revoking again, or revoking garbage, still succeeds (AAD §3)
    await expect(service.logout(session.refreshToken)).resolves.toBeUndefined();
    await expect(service.logout('unknown-token')).resolves.toBeUndefined();
    await expect(service.logout(undefined)).resolves.toBeUndefined();
  });

  it('changePassword__revokes_all_OTHER_sessions_and_clears_forced_change', async () => {
    const user = await createUser({ mustChangePassword: true });
    const service = makeService();
    const phone = await service.login('sara@example.com', PASSWORD);
    const laptop = await service.login('sara@example.com', PASSWORD);

    await service.changePassword(user._id, PASSWORD, 'brand-new-passw0rd', {
      currentTokenHash: hashToken(laptop.refreshToken),
    });

    await expect(service.refresh(phone.refreshToken)).rejects.toThrow(UnauthorizedError);
    await expect(service.refresh(laptop.refreshToken)).resolves.toBeTruthy(); // survives

    const fresh = await User.findById(user._id);
    expect(fresh?.mustChangePassword).toBe(false);
    await pollAudit('PASSWORD_CHANGED').toBe(1);

    // New password live, old dead
    await expect(service.login('sara@example.com', PASSWORD)).rejects.toThrow(UnauthorizedError);
    await expect(service.login('sara@example.com', 'brand-new-passw0rd')).resolves.toBeTruthy();
  });

  it('changePassword__wrong_current_password_is_401_and_changes_nothing', async () => {
    const user = await createUser();
    const service = makeService();
    await expect(
      service.changePassword(user._id, 'wrong-password-9', 'brand-new-passw0rd'),
    ).rejects.toThrow(UnauthorizedError);
    await expect(service.login('sara@example.com', PASSWORD)).resolves.toBeTruthy();
  });
});

describe('reset flow (UC-03, DBR-04 — single-use, 30-min, hashed at rest)', () => {
  it('reset__issue_revokes_sessions_and_complete_installs_password', async () => {
    const admin = await createUser({ email: 'admin@example.com', role: 'ADMIN' });
    const target = await createUser({ mustChangePassword: true });
    const service = makeService();
    const session = await service.login('sara@example.com', PASSWORD);

    const { token, expiresAt } = await service.issueReset(target._id.toString(), admin._id, {
      ip: '203.0.113.7',
    });
    expect(expiresAt).toEqual(new Date(clock.getTime() + 30 * 60_000));

    // Sessions died AT ISSUE (§3.3); raw token is stored hashed only
    await expect(service.refresh(session.refreshToken)).rejects.toThrow(UnauthorizedError);
    const stored = await User.findById(target._id);
    expect(stored?.resetTokenHash).toBe(hashToken(token));
    await pollAudit('PASSWORD_RESET_ISSUED').toBe(1);

    await service.completeReset(token, 'brand-new-passw0rd');
    const fresh = await User.findById(target._id);
    expect(fresh?.mustChangePassword).toBe(false); // the user just chose it
    expect(fresh?.resetTokenHash).toBeUndefined(); // consumed — PDV-04 absent
    await pollAudit('PASSWORD_RESET_COMPLETED').toBe(1);
    await expect(service.login('sara@example.com', 'brand-new-passw0rd')).resolves.toBeTruthy();
  });

  it('reset__token_is_single_use', async () => {
    const admin = await createUser({ email: 'admin@example.com', role: 'ADMIN' });
    const target = await createUser();
    const service = makeService();
    const { token } = await service.issueReset(target._id.toString(), admin._id);

    await service.completeReset(token, 'brand-new-passw0rd');
    await expect(service.completeReset(token, 'another-passw0rd-1')).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it('reset__token_expires_by_value_after_30_minutes', async () => {
    const admin = await createUser({ email: 'admin@example.com', role: 'ADMIN' });
    const target = await createUser();
    const service = makeService();
    const { token } = await service.issueReset(target._id.toString(), admin._id);

    advance(30 * 60_000 + 1000);
    await expect(service.completeReset(token, 'brand-new-passw0rd')).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it('reset__unknown_target_404_and_inactive_target_400', async () => {
    const admin = await createUser({ email: 'admin@example.com', role: 'ADMIN' });
    const inactive = await createUser({ isActive: false });
    const service = makeService();

    await expect(service.issueReset('665f2b1a0000000000000009', admin._id)).rejects.toThrow(
      NotFoundError,
    );

    const failure = await service
      .issueReset(inactive._id.toString(), admin._id)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AppError);
    expect((failure as AppError).code).toBe('VALIDATION_ERROR'); // VAL §5: 400
  });
});
