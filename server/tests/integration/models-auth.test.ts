/**
 * F1 T-b — RefreshToken + AuditLog models and the DBD §5 JSON-schema
 * validators, against ephemeral Mongo. Completion criteria (IMP-020 T-b):
 * index behavior + validator-rejection tests green.
 *
 * Validator tests write through the NATIVE driver on purpose — the second
 * layer exists precisely for writes that bypass Mongoose (DBD §5).
 */
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AuditLog } from '../../src/models/AuditLog.js';
import { applyJsonValidators } from '../../src/models/jsonValidators.js';
import { RefreshToken } from '../../src/models/RefreshToken.js';
import { User } from '../../src/models/User.js';

let mongod: MongoMemoryServer;

const DOC_VALIDATION_FAILURE = 121;

const actorId = new Types.ObjectId();

function validRefreshToken(overrides: Record<string, unknown> = {}) {
  return {
    userId: new Types.ObjectId(),
    tokenHash: `sha256:${new Types.ObjectId().toHexString()}`,
    familyId: `fam_${new Types.ObjectId().toHexString()}`,
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    ...overrides,
  };
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all([User.init(), RefreshToken.init(), AuditLog.init()]);
  await applyJsonValidators();
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

afterEach(async () => {
  await Promise.all([User.deleteMany({}), RefreshToken.deleteMany({}), AuditLog.deleteMany({})]);
});

describe('RefreshToken model (DBD §2.5)', () => {
  it('enforces tokenHash uniqueness — the rotation point-read index', async () => {
    const first = validRefreshToken();
    await RefreshToken.create(first);
    await expect(
      RefreshToken.create(validRefreshToken({ tokenHash: first.tokenHash })),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('declares the §2.5 index set: userId, familyId, TTL on expiresAt (GC only, PDV-03)', async () => {
    const indexes = await RefreshToken.collection.indexes();
    const byKey = (key: Record<string, number>) =>
      indexes.find((index) => JSON.stringify(index.key) === JSON.stringify(key));

    expect(byKey({ userId: 1 })).toBeDefined(); // revoke-all
    expect(byKey({ familyId: 1 })).toBeDefined(); // family revocation (BR-35)
    const ttl = byKey({ expiresAt: 1 });
    expect(ttl?.expireAfterSeconds).toBe(0); // cleanup only — never a boundary
  });

  it('stores no updatedAt — rotation stamps explicit fields instead', async () => {
    const doc = await RefreshToken.create(validRefreshToken());
    const raw = await RefreshToken.collection.findOne({ _id: doc._id });
    expect(raw).not.toHaveProperty('updatedAt');
    expect(raw).toHaveProperty('createdAt');
  });
});

describe('AuditLog model (DBD §2.6 ∎ append-only)', () => {
  it('accepts a minimal security event (no entityId, no changes — AAD §7)', async () => {
    const doc = await AuditLog.create({
      actorId,
      entityType: 'SECURITY',
      action: 'LOGIN_FAILED',
      entityLabel: 'admin@example.com',
      ip: '203.0.113.7',
    });
    const raw = await AuditLog.collection.findOne({ _id: doc._id });
    expect(raw).not.toHaveProperty('updatedAt'); // DES-1
    expect(raw).not.toHaveProperty('changes'); // absent, not []
  });

  it('accepts an entity diff with changes[] (money as API strings, DBR-05)', async () => {
    await AuditLog.create({
      actorId,
      entityType: 'USER',
      entityId: new Types.ObjectId(),
      action: 'ROLE_CHANGE',
      entityLabel: 'staff@example.com',
      changes: [{ field: 'role', before: 'STAFF', after: 'ADMIN' }],
    });
    expect(await AuditLog.countDocuments()).toBe(1);
  });

  it('declares the R-5 filter indexes', async () => {
    const indexes = await AuditLog.collection.indexes();
    const keys = indexes.map((index) => JSON.stringify(index.key));
    expect(keys).toContain(JSON.stringify({ entityType: 1, createdAt: -1 }));
    expect(keys).toContain(JSON.stringify({ actorId: 1, createdAt: -1 }));
    expect(keys).toContain(JSON.stringify({ entityId: 1, createdAt: -1 }));
  });

  it('rejects an out-of-catalog action at the Mongoose layer (PDV-01 closed set)', async () => {
    await expect(
      AuditLog.create({
        actorId,
        entityType: 'SECURITY',
        action: 'SOMETHING_NEW',
        entityLabel: 'x',
      }),
    ).rejects.toThrow(/SOMETHING_NEW/);
  });
});

describe('JSON-schema validators — the DBD §5 second layer (native-driver writes)', () => {
  const db = () => mongoose.connection.db!;

  it('is idempotent — re-applying (a re-run release) succeeds', async () => {
    await expect(applyJsonValidators()).resolves.toBeUndefined();
  });

  it('users: rejects an out-of-enum role that bypassed Mongoose', async () => {
    await expect(
      db().collection('users').insertOne({
        name: 'Root',
        email: 'root@example.com',
        passwordHash: '$2b$12$x',
        role: 'ROOT', // not ADMIN|STAFF
        isActive: true,
        mustChangePassword: false,
        failedLoginCount: 0,
      }),
    ).rejects.toMatchObject({ code: DOC_VALIDATION_FAILURE });
  });

  it('users: rejects an EMPTY-STRING resetTokenHash (PDV-04 — sparse index purity)', async () => {
    await expect(
      db().collection('users').insertOne({
        name: 'Sara',
        email: 'sara@example.com',
        passwordHash: '$2b$12$x',
        role: 'STAFF',
        isActive: true,
        mustChangePassword: false,
        failedLoginCount: 0,
        resetTokenHash: '', // must be ABSENT, never ''
      }),
    ).rejects.toMatchObject({ code: DOC_VALIDATION_FAILURE });
  });

  it('users: rejects a negative failedLoginCount (BR-33 counter integrity)', async () => {
    await expect(
      db().collection('users').insertOne({
        name: 'Sara',
        email: 'sara2@example.com',
        passwordHash: '$2b$12$x',
        role: 'STAFF',
        isActive: true,
        mustChangePassword: false,
        failedLoginCount: -1,
      }),
    ).rejects.toMatchObject({ code: DOC_VALIDATION_FAILURE });
  });

  it('refreshtokens: rejects a session row missing its tokenHash', async () => {
    await expect(
      db().collection('refreshtokens').insertOne({
        userId: new Types.ObjectId(),
        familyId: 'fam_x',
        expiresAt: new Date(),
      }),
    ).rejects.toMatchObject({ code: DOC_VALIDATION_FAILURE });
  });

  it('auditlogs: rejects any document carrying updatedAt (DES-1 — append-only shape)', async () => {
    await expect(
      db().collection('auditlogs').insertOne({
        actorId,
        entityType: 'SECURITY',
        action: 'LOGIN_SUCCESS',
        entityLabel: 'admin@example.com',
        createdAt: new Date(),
        updatedAt: new Date(), // an audit row can never look edited
      }),
    ).rejects.toMatchObject({ code: DOC_VALIDATION_FAILURE });
  });

  it('auditlogs: rejects an out-of-catalog action at the DB layer too (PDV-01)', async () => {
    await expect(
      db().collection('auditlogs').insertOne({
        actorId,
        entityType: 'SECURITY',
        action: 'SOMETHING_NEW',
        entityLabel: 'x',
        createdAt: new Date(),
      }),
    ).rejects.toMatchObject({ code: DOC_VALIDATION_FAILURE });
  });

  it('valid Mongoose writes pass through all three validators untouched', async () => {
    await User.create({
      name: 'Sara',
      email: 'valid@example.com',
      passwordHash: '$2b$12$x',
      role: 'STAFF',
    });
    await RefreshToken.create(validRefreshToken());
    await AuditLog.create({
      actorId,
      entityType: 'SECURITY',
      action: 'LOGIN_SUCCESS',
      entityLabel: 'valid@example.com',
    });
  });
});
