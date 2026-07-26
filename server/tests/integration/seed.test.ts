/**
 * Task 0.7 (SaaS-adapted) — the seed + boot integrity, on ephemeral replica-set
 * Mongo (TST §5: "seed idempotency is itself a test"; this exercises the
 * PRODUCTION seed module). Under multi-tenancy the seed provisions ONE bootstrap
 * tenant (org + first Admin + settings + Uncategorized) idempotently, and boot
 * integrity is a PER-TENANT coherence check (an empty system is valid/ready).
 *
 * Direct model reads run in SYSTEM context (they span the whole DB); the one
 * per-tenant uniqueness assertion switches into the seeded tenant explicitly.
 */
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createLogger } from '../../src/lib/logger.js';
import { Category, CATEGORY_NAME_COLLATION } from '../../src/models/Category.js';
import { Organization } from '../../src/models/Organization.js';
import { Settings } from '../../src/models/Settings.js';
import { User } from '../../src/models/User.js';
import { IntegrityError, verifyBootIntegrity } from '../../src/seeds/integrity.js';
import { runSeed, UNCATEGORIZED_NAME } from '../../src/seeds/index.js';
import { enterSystemContextForTesting, enterTenantContextForTesting } from '../helpers/tenant.js';

let replSet: MongoMemoryReplSet;
const logger = createLogger('info', { write: () => undefined });

const SEED_ENV = {
  SEED_ADMIN_EMAIL: 'Admin@Example.com', // mixed case on purpose — must normalize
  SEED_ADMIN_PASSWORD: 'initial-secret-1',
};

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
});

// Direct reads/writes in these specs span the whole DB — system context.
beforeEach(() => {
  enterSystemContextForTesting();
});

afterEach(async () => {
  enterSystemContextForTesting(); // a per-tenant test may have switched context
  await Promise.all([
    User.deleteMany({}),
    Settings.deleteMany({}),
    Category.deleteMany({}),
    Organization.deleteMany({}),
  ]);
});

describe('runSeed (DBD §8 — idempotent bootstrap tenant, never destructive)', () => {
  it('provisions exactly one bootstrap tenant on first run', async () => {
    const result = await runSeed(SEED_ENV, logger);
    expect(result).toEqual({
      adminCreated: true,
      settingsCreated: true,
      uncategorizedCreated: true,
    });

    expect(await Organization.countDocuments({})).toBe(1);
    expect(await User.countDocuments({})).toBe(1);
    expect(await Settings.countDocuments({})).toBe(1);
    expect(await Category.countDocuments({})).toBe(1);
  });

  it('provisions the Admin per spec: normalized email, bcrypt hash, forced change', async () => {
    await runSeed(SEED_ENV, logger);
    const admin = await User.findOne({ email: 'admin@example.com' }).select('+passwordHash');
    expect(admin).not.toBeNull();
    expect(admin?.role).toBe('ADMIN');
    expect(admin?.isActive).toBe(true);
    expect(admin?.mustChangePassword).toBe(true); // DBD §8 — rotate at first login
    expect(admin?.passwordHash).toMatch(/^\$2b\$12\$/); // bcrypt cost 12 (BR-32)
    expect(await bcrypt.compare(SEED_ENV.SEED_ADMIN_PASSWORD, admin?.passwordHash ?? '')).toBe(
      true,
    );
    // The admin is bound to the provisioned tenant, which owns it.
    const org = await Organization.findOne({});
    expect(admin?.tenantId.toString()).toBe(org?._id.toString());
    expect(org?.ownerUserId.toString()).toBe(admin?._id.toString());
  });

  it('passwordHash is select:false — invisible to default queries (DBD §2.1)', async () => {
    await runSeed(SEED_ENV, logger);
    const admin = await User.findOne({ email: 'admin@example.com' });
    expect(admin?.passwordHash).toBeUndefined();
  });

  it('is idempotent: second run provisions nothing', async () => {
    await runSeed(SEED_ENV, logger);
    const second = await runSeed(SEED_ENV, logger);
    expect(second).toEqual({
      adminCreated: false,
      settingsCreated: false,
      uncategorizedCreated: false,
    });
    expect(await Organization.countDocuments({})).toBe(1);
    expect(await User.countDocuments({})).toBe(1);
    expect(await Settings.countDocuments({})).toBe(1);
    expect(await Category.countDocuments({})).toBe(1);
  });

  it('is never destructive: operator changes survive a re-run', async () => {
    await runSeed(SEED_ENV, logger);

    // Operator rotates the admin password and edits settings post-launch…
    const rotatedHash = await bcrypt.hash('rotated-password-9', 4); // cheap cost: test only
    await User.updateOne(
      { email: 'admin@example.com' },
      { $set: { passwordHash: rotatedHash, mustChangePassword: false } },
    );
    await Settings.updateOne({}, { $set: { currency: 'EUR', defaultLowStockThreshold: 25 } });

    // …then the next release runs the seed phase again (DEP §11):
    await runSeed(SEED_ENV, logger);

    const admin = await User.findOne({ email: 'admin@example.com' }).select('+passwordHash');
    expect(admin?.passwordHash).toBe(rotatedHash); // untouched
    expect(admin?.mustChangePassword).toBe(false); // untouched
    const settings = await Settings.findOne({});
    expect(settings?.currency).toBe('EUR'); // untouched
    expect(settings?.defaultLowStockThreshold).toBe(25);
  });

  it('Uncategorized is the per-tenant collation natural key — a lowercase twin cannot be added', async () => {
    await runSeed(SEED_ENV, logger);
    const org = await Organization.findOne({});
    // Switch into the seeded tenant to assert its per-tenant uniqueness.
    enterTenantContextForTesting(org!._id);

    const found = await Category.findOne({ name: 'uncategorized' }).collation(
      CATEGORY_NAME_COLLATION,
    );
    expect(found?.name).toBe(UNCATEGORIZED_NAME);
    expect(found?.isSystem).toBe(true);

    await expect(Category.create({ name: 'UNCATEGORIZED', isSystem: false })).rejects.toMatchObject(
      { code: 11000 },
    ); // per-tenant unique collation index (DBD §2.2)
  });
});

describe('verifyBootIntegrity (SaaS — per-tenant coherence + remediation message)', () => {
  it('passes on a seeded database', async () => {
    await runSeed(SEED_ENV, logger);
    await expect(verifyBootIntegrity()).resolves.toBeUndefined();
  });

  it('passes on an EMPTY system — a fresh SaaS install with no tenants is ready', async () => {
    await expect(verifyBootIntegrity()).resolves.toBeUndefined();
  });

  it('fails when a tenant exists but its bootstrap data is missing, naming BOTH problems + the fix', async () => {
    // A tenant with neither settings nor an active admin — an incoherent state.
    await Organization.create({
      name: 'Broken Co',
      slug: 'broken-co',
      ownerUserId: new mongoose.Types.ObjectId(),
    });
    const failure = await verifyBootIntegrity().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(IntegrityError);
    const message = (failure as Error).message;
    expect(message).toContain('no settings document');
    expect(message).toContain('no active Admin');
    expect(message).toContain('npm run seed'); // the remediation (DBD §8)
  });

  it('fails when the only Admin is deactivated (BR-30 is about ACTIVE admins)', async () => {
    await runSeed(SEED_ENV, logger);
    await User.updateOne({ email: 'admin@example.com' }, { $set: { isActive: false } });
    await expect(verifyBootIntegrity()).rejects.toThrowError(/no active Admin/);
  });
});
