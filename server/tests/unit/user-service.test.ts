/**
 * F2 T-c — UserService vs BR-29…31 on a REPLICA-SET memory server (T6 runs
 * real transactions). The load-bearing test is the CONCURRENT-DEMOTION RACE:
 * snapshot isolation alone would let two parallel demotions of two different
 * admins both commit — the shared-guard write conflict is what makes BR-30
 * hold. Also: the AuditService diff path (first consumer).
 */
import bcrypt from 'bcrypt';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DuplicateEmailError, LastAdminError, NotFoundError } from '../../src/errors/AppError.js';
import { createLogger } from '../../src/lib/logger.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { RefreshToken } from '../../src/models/RefreshToken.js';
import { User } from '../../src/models/User.js';
import { AuditService } from '../../src/services/AuditService.js';
import { AuthService } from '../../src/services/AuthService.js';
import { UserService } from '../../src/services/UserService.js';
import { usersQuerySchema } from '../../src/validation/schemas/users.js';

const PASSWORD = 'correct-h0rse-battery';
const TEST_COST = 4;
const CLIENT_ORIGIN = 'http://localhost:5173';

let replSet: MongoMemoryReplSet;
const logger = createLogger('error', { write: () => undefined });
const actorId = new Types.ObjectId(); // the acting Admin in audit rows

function makeService(): UserService {
  const audit = new AuditService(logger);
  return new UserService({
    audit,
    authService: new AuthService({
      audit,
      logger,
      config: {
        accessSecret: 'user-service-test-secret-32-chars!!',
        accessTtl: '15m',
        refreshTtl: '7d',
      },
      bcryptCost: TEST_COST,
    }),
    clientOrigin: CLIENT_ORIGIN,
    bcryptCost: TEST_COST,
  });
}

async function seedUser(overrides: Partial<Record<string, unknown>> = {}) {
  return User.create({
    name: 'Sara An',
    email: `user-${new Types.ObjectId().toHexString()}@example.com`,
    passwordHash: bcrypt.hashSync(PASSWORD, TEST_COST),
    role: 'STAFF',
    mustChangePassword: false,
    ...overrides,
  });
}

function query(overrides: Record<string, unknown> = {}) {
  return usersQuerySchema.parse(overrides);
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
});

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), RefreshToken.deleteMany({}), AuditLog.deleteMany({})]);
});

describe('create (BR-31 — provisioning)', () => {
  it('BR-31__provisioned_accounts_force_a_password_change', async () => {
    const service = makeService();
    const user = await service.create(
      { name: 'New Staff', email: 'staff@example.com', role: 'STAFF', temporaryPassword: PASSWORD },
      actorId,
    );
    expect(user.mustChangePassword).toBe(true); // server-set, never client-supplied

    const stored = await User.findById(user._id).select('+passwordHash');
    expect(stored?.passwordHash).toMatch(/^\$2b\$/);
    expect(await bcrypt.compare(PASSWORD, stored?.passwordHash ?? '')).toBe(true);

    const row = await AuditLog.findOne({ action: 'CREATE', entityType: 'USER' });
    expect(row?.entityLabel).toBe('staff@example.com'); // DN-4
  });

  it('BR-31__duplicate_email_maps_the_unique_index_to_409', async () => {
    const service = makeService();
    await seedUser({ email: 'dup@example.com' });
    await expect(
      service.create(
        { name: 'Twin', email: 'dup@example.com', role: 'STAFF', temporaryPassword: PASSWORD },
        actorId,
      ),
    ).rejects.toThrow(DuplicateEmailError);
  });
});

describe('update (BR-30 — T6)', () => {
  it('BR-30__demoting_the_sole_active_admin_is_rejected', async () => {
    const service = makeService();
    const admin = await seedUser({ role: 'ADMIN', email: 'admin@example.com' });
    await expect(
      service.update(admin._id.toString(), { role: 'STAFF' }, admin._id),
    ).rejects.toThrow(LastAdminError); // self-demotion included (AAD §5.2)
    await expect(
      service.update(admin._id.toString(), { isActive: false }, admin._id),
    ).rejects.toThrow(LastAdminError);
  });

  it('BR-30__T6_concurrent_demotion_race_leaves_at_least_one_active_admin', async () => {
    const service = makeService();
    const adminA = await seedUser({ role: 'ADMIN', email: 'admin-a@example.com' });
    const adminB = await seedUser({ role: 'ADMIN', email: 'admin-b@example.com' });

    // Two parallel T6s, each demoting a DIFFERENT admin document — snapshot
    // isolation alone would let both commit (0 admins). The shared guard
    // makes them collide; the retried loser must see count=1 and throw.
    const results = await Promise.allSettled([
      service.update(adminA._id.toString(), { role: 'STAFF' }, actorId),
      service.update(adminB._id.toString(), { role: 'STAFF' }, actorId),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(LastAdminError);

    const activeAdmins = await User.countDocuments({ role: 'ADMIN', isActive: true });
    expect(activeAdmins).toBe(1); // the invariant, verbatim
  });

  it('FR-USER-04__role_change_and_deactivation_revoke_target_sessions_atomically', async () => {
    const service = makeService();
    await seedUser({ role: 'ADMIN', email: 'admin@example.com' }); // second admin keeps BR-30 satisfied
    const target = await seedUser({ role: 'ADMIN', email: 'demote-me@example.com' });
    await RefreshToken.create({
      userId: target._id,
      tokenHash: 'sha256:deadbeef',
      familyId: 'fam_x',
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    await service.update(target._id.toString(), { role: 'STAFF' }, actorId);
    const session = await RefreshToken.findOne({ userId: target._id });
    expect(session?.revokedAt).toBeInstanceOf(Date);
  });

  it('audit_diff__action_priority_and_changes_content (Issue 2 diff path)', async () => {
    const service = makeService();
    await seedUser({ role: 'ADMIN', email: 'admin@example.com' });
    const target = await seedUser({ name: 'Old Name', email: 'target@example.com' });

    // name-only → UPDATE with a name diff
    await service.update(target._id.toString(), { name: 'New Name' }, actorId);
    const updateRow = await AuditLog.findOne({ action: 'UPDATE', entityId: target._id });
    expect(updateRow?.toObject().changes).toEqual([
      { field: 'name', before: 'Old Name', after: 'New Name' },
    ]);

    // role → ROLE_CHANGE
    await service.update(target._id.toString(), { role: 'ADMIN' }, actorId);
    const roleRow = await AuditLog.findOne({ action: 'ROLE_CHANGE', entityId: target._id });
    expect(roleRow?.toObject().changes).toEqual([
      { field: 'role', before: 'STAFF', after: 'ADMIN' },
    ]);

    // deactivation wins the action name even when role changes too
    await service.update(target._id.toString(), { role: 'STAFF', isActive: false }, actorId);
    const deactivateRow = await AuditLog.findOne({ action: 'DEACTIVATE', entityId: target._id });
    expect(deactivateRow?.toObject().changes).toEqual(
      expect.arrayContaining([
        { field: 'role', before: 'ADMIN', after: 'STAFF' },
        { field: 'isActive', before: true, after: false },
      ]),
    );

    // no-op update writes NO audit row
    const before = await AuditLog.countDocuments({});
    await service.update(target.id, { name: 'New Name' }, actorId);
    expect(await AuditLog.countDocuments({})).toBe(before);
  });

  it('update__unknown_id_404s', async () => {
    const service = makeService();
    await expect(
      service.update(new Types.ObjectId().toHexString(), { name: 'Ghost' }, actorId),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('BR-29 — accounts are permanent', () => {
  it('BR-29__the_service_exposes_no_delete_surface', () => {
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(makeService()));
    expect(surface.some((name) => /delete|remove/i.test(name))).toBe(false);
  });
});

describe('list (FR-USER-02)', () => {
  it('filters, searches (case-insensitive partial), sorts, and paginates', async () => {
    const service = makeService();
    await seedUser({ name: 'Alice Admin', email: 'alice@example.com', role: 'ADMIN' });
    await seedUser({ name: 'Bob Staff', email: 'bob@example.com' });
    await seedUser({ name: 'Carol Staff', email: 'carol@example.com', isActive: false });

    const admins = await service.list(query({ role: 'ADMIN' }));
    expect(admins.totalItems).toBe(1);

    const active = await service.list(query({ isActive: 'true' }));
    expect(active.totalItems).toBe(2);

    const searched = await service.list(query({ search: 'BOB' }));
    expect(searched.data.map((u) => u.email)).toEqual(['bob@example.com']);

    const sorted = await service.list(query({ sort: 'name', order: 'asc', limit: '2' }));
    expect(sorted.data.map((u) => u.name)).toEqual(['Alice Admin', 'Bob Staff']);
    expect(sorted.totalPages).toBe(2);

    // regex metacharacters are literals, never patterns
    const hostile = await service.list(query({ search: '.*' }));
    expect(hostile.totalItems).toBe(0);
  });
});

describe('updateMe / reset link', () => {
  it('updateMe__diffs_the_name_and_audits_it', async () => {
    const service = makeService();
    const user = await seedUser({ name: 'Before' });
    await service.updateMe(user._id, 'After');
    const row = await AuditLog.findOne({ action: 'UPDATE', entityId: user._id });
    expect(row?.toObject().changes).toEqual([{ field: 'name', before: 'Before', after: 'After' }]);

    const count = await AuditLog.countDocuments({});
    await service.updateMe(user._id, 'After'); // unchanged → no row
    expect(await AuditLog.countDocuments({})).toBe(count);
  });

  it('issueResetLink__assembles_the_out_of_band_link (AS-6)', async () => {
    const service = makeService();
    const target = await seedUser();
    const { resetLink, expiresAt } = await service.issueResetLink(target._id.toString(), actorId);
    expect(resetLink).toMatch(
      new RegExp(`^${CLIENT_ORIGIN}/reset-password\\?token=[A-Za-z0-9_-]{43}$`),
    );
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('AuditService.computeChanges (diff path unit)', () => {
  it('omits unchanged fields and NEVER diffs sensitive ones', () => {
    const changes = AuditService.computeChanges(
      { name: 'A', role: 'STAFF', passwordHash: 'old', resetTokenHash: 'x' },
      { name: 'B', role: 'STAFF', passwordHash: 'new', resetTokenHash: 'y' },
      ['name', 'role', 'passwordHash', 'resetTokenHash'],
    );
    expect(changes).toEqual([{ field: 'name', before: 'A', after: 'B' }]);
  });
});
