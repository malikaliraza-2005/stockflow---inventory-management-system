/**
 * F7 (P5 slice) T-d — GET /audit-logs through the REAL pipeline: the Admin gate
 * (audit.view → Staff 403), the filter matrix (entityType / actor / date),
 * resolved actor names + entity-diff changes[], security events visible, and
 * entityLabel (DN-4) still rendering AFTER the entity is hard-deleted.
 */
import bcrypt from 'bcrypt';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { useTestTenant } from '../helpers/tenant.js';

import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/lib/logger.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { Category } from '../../src/models/Category.js';
import { Product } from '../../src/models/Product.js';
import { RefreshToken } from '../../src/models/RefreshToken.js';
import { Settings } from '../../src/models/Settings.js';
import { Transaction } from '../../src/models/Transaction.js';
import { User } from '../../src/models/User.js';
import { makeTestEnv } from '../helpers/testEnv.js';

const PASSWORD = 'correct-h0rse-battery';
const AUDIT = '/api/v1/audit-logs';

let replSet: MongoMemoryReplSet;
let categoryId: string;
const logger = createLogger('error', { write: () => undefined });

function makeApp() {
  return createApp({ logger, isReady: () => true, env: makeTestEnv() });
}

async function seedUser(overrides: Partial<Record<string, unknown>> = {}) {
  return User.create({
    name: 'Sara An',
    email: `user-${new Types.ObjectId().toHexString()}@example.com`,
    passwordHash: bcrypt.hashSync(PASSWORD, 4),
    role: 'STAFF',
    mustChangePassword: false,
    ...overrides,
  });
}

async function loginAs(app: ReturnType<typeof makeApp>, email: string): Promise<string> {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return `Bearer ${res.body.accessToken}`;
}

useTestTenant(); // SaaS: run every test in a fixed tenant context

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  await Promise.all([Product.init(), Category.init(), Transaction.init(), AuditLog.init()]);
});

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
});

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    RefreshToken.deleteMany({}),
    AuditLog.deleteMany({}),
    Category.deleteMany({}),
    Product.deleteMany({}),
    Transaction.deleteMany({}),
    Settings.deleteMany({}),
    mongoose.connection.collection('counters').deleteMany({}),
  ]);
  await Settings.create({
    currency: 'USD',
    defaultLowStockThreshold: 10,
    movementWarningThreshold: 1000,
  });
  const cat = await Category.create({ name: 'Electronics' });
  categoryId = cat._id.toString();
});

describe('auth + role gate', () => {
  it('401 without a token', async () => {
    expect((await request(makeApp()).get(AUDIT)).status).toBe(401);
  });

  it('Staff is 403 (audit.view is Admin-only); Admin is 200', async () => {
    const app = makeApp();
    await seedUser({ email: 'staff@example.com' });
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    const staff = await loginAs(app, 'staff@example.com');
    const admin = await loginAs(app, 'admin@example.com');
    expect((await request(app).get(AUDIT).set('Authorization', staff)).status).toBe(403);
    expect((await request(app).get(AUDIT).set('Authorization', admin)).status).toBe(200);
  });
});

describe('entity diffs + actor names', () => {
  it('surfaces a product UPDATE with resolved actorName and before/after changes', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN', name: 'Admin One' });
    const admin = await loginAs(app, 'admin@example.com');

    const created = await request(app)
      .post('/api/v1/products')
      .set('Authorization', admin)
      .send({ name: 'Old Name', categoryId, costPrice: '10.00', sellingPrice: '15.00' });
    expect(created.status).toBe(201);
    const patched = await request(app)
      .patch(`/api/v1/products/${created.body.id}`)
      .set('Authorization', admin)
      .send({ name: 'New Name', version: created.body.version });
    expect(patched.status).toBe(200);

    const res = await request(app).get(`${AUDIT}?entityType=PRODUCT`).set('Authorization', admin);
    expect(res.status).toBe(200);
    const update = res.body.data.find((r: { action: string }) => r.action === 'UPDATE');
    expect(update.actorName).toBe('Admin One');
    const nameChange = update.changes.find((c: { field: string }) => c.field === 'name');
    expect(nameChange).toMatchObject({ before: 'Old Name', after: 'New Name' });
  });
});

describe('security events + entityType filter', () => {
  it('surfaces SECURITY rows and filters by entity type', async () => {
    const app = makeApp();
    const admin = await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    const auth = await loginAs(app, 'admin@example.com');

    await AuditLog.create({
      actorId: admin._id,
      entityType: 'SECURITY',
      action: 'LOGIN_FAILED',
      entityLabel: 'unknown@example.com',
      ip: '203.0.113.9',
    });

    const res = await request(app).get(`${AUDIT}?entityType=SECURITY`).set('Authorization', auth);
    expect(res.status).toBe(200);
    // Every row is SECURITY (the filter holds); the login also logs LOGIN_SUCCESS.
    expect(res.body.data.every((r: { entityType: string }) => r.entityType === 'SECURITY')).toBe(
      true,
    );
    const failed = res.body.data.find((r: { action: string }) => r.action === 'LOGIN_FAILED');
    expect(failed).toMatchObject({ entityLabel: 'unknown@example.com', ip: '203.0.113.9' });
  });
});

describe('DN-4 label survives hard delete + actor filter', () => {
  it('renders entityLabel after the product is gone; actor filter narrows rows', async () => {
    const app = makeApp();
    const admin = await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    const auth = await loginAs(app, 'admin@example.com');

    // A zero-history product (initialQuantity 0 → no INITIAL row) is hard-deletable.
    const created = await request(app).post('/api/v1/products').set('Authorization', auth).send({
      name: 'Ephemeral',
      categoryId,
      costPrice: '1.00',
      sellingPrice: '2.00',
      initialQuantity: 0,
    });
    expect(created.status).toBe(201);
    const del = await request(app)
      .delete(`/api/v1/products/${created.body.id}`)
      .set('Authorization', auth);
    expect(del.status).toBe(204);
    expect(await Product.findById(created.body.id)).toBeNull(); // truly gone

    const res = await request(app).get(`${AUDIT}?entityType=PRODUCT`).set('Authorization', auth);
    const deleted = res.body.data.find((r: { action: string }) => r.action === 'DELETE');
    expect(deleted.entityLabel).toBeTruthy(); // captured at write time (DN-4)

    // Actor filter: a row by a DIFFERENT actor must not appear.
    const other = new Types.ObjectId();
    await AuditLog.create({
      actorId: other,
      entityType: 'CATEGORY',
      action: 'CREATE',
      entityLabel: 'SomeoneElse',
    });
    const mine = await request(app)
      .get(`${AUDIT}?actorId=${admin._id.toString()}`)
      .set('Authorization', auth);
    expect(
      mine.body.data.every((r: { actorId: string }) => r.actorId === admin._id.toString()),
    ).toBe(true);
  });
});
