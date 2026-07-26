/**
 * F9 T-d/T-c — GET /dashboard/summary through the REAL pipeline on a replica-set
 * memory server, plus the DashboardService cache-staleness bound driven directly
 * with an injected clock (BR-25):
 *   - role gate (dashboard.view — both roles) + 401
 *   - range validation (7/30/90 pass, absent → 30 default, 14 → 400)
 *   - aggregate correctness vs seeded factory data (totals exclude archived;
 *     low/out-of-stock counts + items; recent rows; chart buckets + sums)
 *   - cache: asOf frozen within TTL despite new writes; refreshed past TTL
 */
import { randomUUID } from 'node:crypto';

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
import { DashboardService } from '../../src/services/DashboardService.js';
import { makeTestEnv } from '../helpers/testEnv.js';

const PASSWORD = 'correct-h0rse-battery';
const SUMMARY = '/api/v1/dashboard/summary';

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

interface ProductSeed {
  name: string;
  initialQuantity: number;
  costPrice: string;
  lowStockThreshold?: number;
}

async function createProduct(
  app: ReturnType<typeof makeApp>,
  admin: string,
  seed: ProductSeed,
): Promise<string> {
  const res = await request(app)
    .post('/api/v1/products')
    .set('Authorization', admin)
    .send({ sellingPrice: '99.00', categoryId, ...seed });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

function move(app: ReturnType<typeof makeApp>, auth: string, body: object) {
  return request(app)
    .post('/api/v1/inventory/movements')
    .set('Authorization', auth)
    .set('Idempotency-Key', randomUUID())
    .send(body);
}

useTestTenant(); // SaaS: run every test in a fixed tenant context

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  await Promise.all([Product.init(), Category.init(), Transaction.init()]);
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

describe('auth + role', () => {
  it('401 without a token', async () => {
    expect((await request(makeApp()).get(SUMMARY)).status).toBe(401);
  });

  it('both roles may read the dashboard (dashboard.view)', async () => {
    const app = makeApp();
    await seedUser({ email: 'staff@example.com' });
    const staff = await loginAs(app, 'staff@example.com');
    expect((await request(app).get(SUMMARY).set('Authorization', staff)).status).toBe(200);
  });
});

describe('range validation (VAL §5)', () => {
  it('accepts 7/30/90 and defaults to 30 when absent', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    const admin = await loginAs(app, 'admin@example.com');
    for (const range of [undefined, 7, 30, 90]) {
      const url = range === undefined ? SUMMARY : `${SUMMARY}?range=${range}`;
      const res = await request(app).get(url).set('Authorization', admin);
      expect(res.status).toBe(200);
      expect(res.body.charts.transactionVolume).toHaveLength(range ?? 30);
    }
  });

  it('rejects a range outside {7,30,90} with 400 VALIDATION_ERROR', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    const admin = await loginAs(app, 'admin@example.com');
    const res = await request(app).get(`${SUMMARY}?range=14`).set('Authorization', admin);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('aggregate correctness vs factory data', () => {
  it('totals exclude archived; alerts + recent rows + chart sums are correct', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN', name: 'Admin One' });
    const admin = await loginAs(app, 'admin@example.com');

    // In-stock: 50 units × 4.00 = 200.00 value, IN_STOCK (50 > 10)
    await createProduct(app, admin, {
      name: 'InStock',
      initialQuantity: 50,
      costPrice: '4.00',
      lowStockThreshold: 10,
    });
    // Low-stock: 3 units × 5.00 = 15.00, LOW_STOCK (0 < 3 ≤ 10)
    const lowId = await createProduct(app, admin, {
      name: 'LowStock',
      initialQuantity: 3,
      costPrice: '5.00',
      lowStockThreshold: 10,
    });
    // Out-of-stock: created at 5, then emptied → 0 units, 0.00 value, OUT_OF_STOCK
    const outId = await createProduct(app, admin, {
      name: 'OutStock',
      initialQuantity: 5,
      costPrice: '1.00',
    });
    await move(app, admin, { type: 'STOCK_OUT', productId: outId, quantity: 5 });
    // Archived product must NOT count toward totals (create, empty, archive)
    const archId = await createProduct(app, admin, {
      name: 'Archived',
      initialQuantity: 7,
      costPrice: '9.00',
    });
    await move(app, admin, { type: 'STOCK_OUT', productId: archId, quantity: 7 });
    expect(
      (await request(app).post(`/api/v1/products/${archId}/archive`).set('Authorization', admin))
        .status,
    ).toBe(200);

    const res = await request(app).get(`${SUMMARY}?range=7`).set('Authorization', admin);
    expect(res.status).toBe(200);

    // Totals — active only (archived excluded): 3 products, 50+3+0 units, 215.00
    expect(res.body.totals).toEqual({
      activeProducts: 3,
      unitsInStock: 53,
      inventoryValue: '215.00',
    });

    // Alerts
    expect(res.body.lowStock.count).toBe(1);
    expect(res.body.lowStock.items[0].id).toBe(lowId);
    expect(res.body.lowStock.items[0]).toMatchObject({ quantity: 3, lowStockThreshold: 10 });
    expect(res.body.outOfStock.count).toBe(1);
    expect(res.body.outOfStock.items[0].id).toBe(outId);

    // Recent rows: 4 INITIAL + 2 STOCK_OUT = 6 rows, newest first, ledger shape
    expect(res.body.recentTransactions.length).toBe(6);
    expect(res.body.recentTransactions[0]).toMatchObject({
      type: 'STOCK_OUT',
      userName: 'Admin One',
    });

    // Charts: 7 daily buckets; today (last) carries all activity.
    const { movementTrend, transactionVolume } = res.body.charts;
    expect(movementTrend).toHaveLength(7);
    expect(transactionVolume).toHaveLength(7);
    const today = movementTrend[6];
    expect(today.in).toBe(50 + 3 + 5 + 7); // all four INITIAL rows
    expect(today.out).toBe(5 + 7); // both STOCK_OUT rows
    expect(transactionVolume[6].count).toBe(6);
    // asOf is an ISO timestamp
    expect(new Date(res.body.asOf).toISOString()).toBe(res.body.asOf);
  });
});

describe('cache-staleness bound (BR-25, injected clock)', () => {
  it('serves the frozen snapshot within the TTL, then refreshes past it', async () => {
    await Product.create({
      name: 'Solo',
      sku: 'SOLO-1',
      categoryId: new Types.ObjectId(categoryId),
      costPrice: '10.00',
      sellingPrice: '15.00',
      quantity: 4,
      lowStockThreshold: 10,
    });

    let clock = 1_000_000;
    const service = new DashboardService({ cacheTtlMs: 45_000, now: () => clock });

    const first = await service.getSummary(30);
    expect(first.totals.activeProducts).toBe(1);

    // A write lands, but a read WITHIN the TTL must still see the frozen snapshot
    // (same asOf, same count) — the accepted BR-25 lag.
    await Product.create({
      name: 'Second',
      sku: 'SOLO-2',
      categoryId: new Types.ObjectId(categoryId),
      costPrice: '10.00',
      sellingPrice: '15.00',
      quantity: 2,
      lowStockThreshold: 10,
    });
    clock += 30_000; // still inside the 45 s window
    const cached = await service.getSummary(30);
    expect(cached.asOf).toBe(first.asOf);
    expect(cached.totals.activeProducts).toBe(1);

    // Past the TTL → recompute: new asOf, the second product now counted.
    clock += 20_000; // now 50 s since t0 → expired
    const fresh = await service.getSummary(30);
    expect(fresh.asOf).not.toBe(first.asOf);
    expect(fresh.totals.activeProducts).toBe(2);
  });
});
