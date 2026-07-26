/**
 * F11 T-d — GET/PUT /settings through the REAL pipeline on a replica-set memory
 * server: role matrix (both Admin-only), validation, and the F11 ACCEPTANCE —
 * DN-3 threshold changes reach NEW products only; existing products keep their
 * copied lowStockThreshold.
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
  await Promise.all([Product.init(), Category.init()]);
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

describe('role matrix — both Admin-only (§5.2)', () => {
  it('Staff gets 403 on GET and PUT; Admin succeeds', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    await seedUser({ email: 'staff@example.com' });
    const staff = await loginAs(app, 'staff@example.com');
    const admin = await loginAs(app, 'admin@example.com');

    const staffGet = await request(app).get('/api/v1/settings').set('Authorization', staff);
    expect(staffGet.status).toBe(403);
    const staffPut = await request(app)
      .put('/api/v1/settings')
      .set('Authorization', staff)
      .send({ currency: 'EUR', defaultLowStockThreshold: 5, movementWarningThreshold: 500 });
    expect(staffPut.status).toBe(403);

    const adminGet = await request(app).get('/api/v1/settings').set('Authorization', admin);
    expect(adminGet.status).toBe(200);
    expect(adminGet.body).toMatchObject({ currency: 'USD', defaultLowStockThreshold: 10 });
    expect(adminGet.body).not.toHaveProperty('systemCurrency'); // stored field name, not the DTO alias
  });
});

describe('PUT /settings validation + audit', () => {
  it('updates and audits; rejects a bad currency and out-of-range threshold', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    const admin = await loginAs(app, 'admin@example.com');

    const ok = await request(app)
      .put('/api/v1/settings')
      .set('Authorization', admin)
      .send({ currency: 'eur', defaultLowStockThreshold: 20, movementWarningThreshold: 2000 });
    expect(ok.status).toBe(200);
    expect(ok.body.currency).toBe('EUR'); // normalized uppercase

    const audit = await AuditLog.findOne({ entityType: 'SETTINGS', action: 'UPDATE' });
    expect(audit).not.toBeNull();

    const badCurrency = await request(app)
      .put('/api/v1/settings')
      .set('Authorization', admin)
      .send({ currency: 'US', defaultLowStockThreshold: 10, movementWarningThreshold: 1000 });
    expect(badCurrency.status).toBe(400);

    const badThreshold = await request(app)
      .put('/api/v1/settings')
      .set('Authorization', admin)
      .send({ currency: 'USD', defaultLowStockThreshold: 10, movementWarningThreshold: 0 });
    expect(badThreshold.status).toBe(400); // below the 1 minimum
  });
});

describe('DN-3 — threshold reaches NEW products only (F11 acceptance)', () => {
  it('an existing product keeps its copied threshold; a new one gets the updated default', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    const admin = await loginAs(app, 'admin@example.com');

    // product created under default 10 → copies 10
    const before = await request(app)
      .post('/api/v1/products')
      .set('Authorization', admin)
      .send({ name: 'Old', categoryId, costPrice: '1.00', sellingPrice: '2.00' });
    expect(before.body.lowStockThreshold).toBe(10);

    // raise the default to 50
    await request(app)
      .put('/api/v1/settings')
      .set('Authorization', admin)
      .send({ currency: 'USD', defaultLowStockThreshold: 50, movementWarningThreshold: 1000 });

    // the existing product is UNCHANGED (DN-3)
    const stillOld = await request(app)
      .get(`/api/v1/products/${before.body.id}`)
      .set('Authorization', admin);
    expect(stillOld.body.lowStockThreshold).toBe(10);

    // a NEW product copies the new default
    const after = await request(app)
      .post('/api/v1/products')
      .set('Authorization', admin)
      .send({ name: 'New', categoryId, costPrice: '1.00', sellingPrice: '2.00' });
    expect(after.body.lowStockThreshold).toBe(50);
  });
});
