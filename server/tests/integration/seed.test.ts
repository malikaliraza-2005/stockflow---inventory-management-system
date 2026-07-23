/**
 * Task 0.7 — DBD §8 seed + integrity, on ephemeral replica-set Mongo (TST §5:
 * "seed idempotency is itself a test"; this suite exercises the PRODUCTION
 * seed module, not a test double).
 */
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createLogger } from '../../src/lib/logger.js';
import { Category, CATEGORY_NAME_COLLATION } from '../../src/models/Category.js';
import { Settings } from '../../src/models/Settings.js';
import { User } from '../../src/models/User.js';
import { IntegrityError, verifyBootIntegrity } from '../../src/seeds/integrity.js';
import { runSeed, UNCATEGORIZED_NAME } from '../../src/seeds/index.js';

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

afterEach(async () => {
  await Promise.all([User.deleteMany({}), Settings.deleteMany({}), Category.deleteMany({})]);
});

describe('runSeed (DBD §8 — idempotent, never destructive)', () => {
  it('creates exactly the three seed items on first run', async () => {
    const result = await runSeed(SEED_ENV, logger);
    expect(result).toEqual({
      adminCreated: true,
      settingsCreated: true,
      uncategorizedCreated: true,
    });

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
  });

  it('passwordHash is select:false — invisible to default queries (DBD §2.1)', async () => {
    await runSeed(SEED_ENV, logger);
    const admin = await User.findOne({ email: 'admin@example.com' });
    expect(admin?.passwordHash).toBeUndefined();
  });

  it('is idempotent: second run creates nothing', async () => {
    await runSeed(SEED_ENV, logger);
    const second = await runSeed(SEED_ENV, logger);
    expect(second).toEqual({
      adminCreated: false,
      settingsCreated: false,
      uncategorizedCreated: false,
    });
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

  it('Uncategorized is the collation natural key — a lowercase twin cannot be added', async () => {
    await runSeed(SEED_ENV, logger);
    const found = await Category.findOne({ name: 'uncategorized' }).collation(
      CATEGORY_NAME_COLLATION,
    );
    expect(found?.name).toBe(UNCATEGORIZED_NAME);
    expect(found?.isSystem).toBe(true);

    await expect(Category.create({ name: 'UNCATEGORIZED', isSystem: false })).rejects.toMatchObject(
      { code: 11000 },
    ); // unique collation index (DBD §2.2)
  });
});

describe('verifyBootIntegrity (BR-30/41 — with remediation message)', () => {
  it('passes on a seeded database', async () => {
    await runSeed(SEED_ENV, logger);
    await expect(verifyBootIntegrity()).resolves.toBeUndefined();
  });

  it('fails on an empty database, naming BOTH problems and the fix', async () => {
    const failure = await verifyBootIntegrity().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(IntegrityError);
    const message = (failure as Error).message;
    expect(message).toContain('settings singleton missing');
    expect(message).toContain('no active Admin');
    expect(message).toContain('npm run seed'); // the remediation (DBD §8)
  });

  it('fails when the only Admin is deactivated (BR-30 is about ACTIVE admins)', async () => {
    await runSeed(SEED_ENV, logger);
    await User.updateOne({ email: 'admin@example.com' }, { $set: { isActive: false } });
    await expect(verifyBootIntegrity()).rejects.toThrowError(/no active Admin/);
  });
});
