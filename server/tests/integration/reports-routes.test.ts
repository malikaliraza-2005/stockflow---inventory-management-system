/**
 * F10 T-d — the /reports surface through the REAL pipeline on a replica-set
 * memory server: role gates (reports.view both-roles; consistency + export
 * Admin-only → Staff 403), the mandatory date-range vectors (missing/oversized),
 * BR-40 byte-reproducibility, totals rows, drift rendering, and the Admin CSV
 * export (content type + header + rows; Staff 403; unknown name 400).
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
import { makeTestEnv } from '../helpers/testEnv.js';

const PASSWORD = 'correct-h0rse-battery';
const R = '/api/v1/reports';
const TODAY = new Date().toISOString().slice(0, 10);

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

async function createProduct(
  app: ReturnType<typeof makeApp>,
  admin: string,
  seed: { name: string; initialQuantity: number; costPrice: string; lowStockThreshold?: number },
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

/** Seed a small, deterministic catalog + ledger. Returns the two product ids. */
async function seedCatalog(app: ReturnType<typeof makeApp>, admin: string) {
  const p1 = await createProduct(app, admin, {
    name: 'InStock',
    initialQuantity: 50,
    costPrice: '4.00',
    lowStockThreshold: 10,
  });
  const p2 = await createProduct(app, admin, {
    name: 'LowStock',
    initialQuantity: 3,
    costPrice: '5.00',
    lowStockThreshold: 10,
  });
  await move(app, admin, { type: 'STOCK_IN', productId: p1, quantity: 5 });
  await move(app, admin, { type: 'STOCK_OUT', productId: p1, quantity: 2 });
  return { p1, p2 };
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

describe('role gates', () => {
  it('401 without a token', async () => {
    expect((await request(makeApp()).get(`${R}/inventory`)).status).toBe(401);
  });

  it('both roles read inventory (reports.view); Staff is 403 on consistency + export', async () => {
    const app = makeApp();
    await seedUser({ email: 'staff@example.com' });
    const staff = await loginAs(app, 'staff@example.com');
    expect((await request(app).get(`${R}/inventory`).set('Authorization', staff)).status).toBe(200);
    expect((await request(app).get(`${R}/consistency`).set('Authorization', staff)).status).toBe(
      403,
    );
    expect(
      (await request(app).get(`${R}/inventory/export`).set('Authorization', staff)).status,
    ).toBe(403);
  });
});

describe('inventory report (FR-RPT-01)', () => {
  it('returns rows + totals and filters by stock status', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    const admin = await loginAs(app, 'admin@example.com');
    await seedCatalog(app, admin);

    const all = await request(app).get(`${R}/inventory`).set('Authorization', admin);
    expect(all.status).toBe(200);
    // P1 ends at 53 units × 4.00 = 212.00 · P2 at 3 × 5.00 = 15.00 → 56 units, 227.00
    expect(all.body.totals).toEqual({ totalQuantity: 56, totalValue: '227.00' });
    expect(all.body.data).toHaveLength(2);

    const low = await request(app)
      .get(`${R}/inventory?stockStatus=LOW_STOCK`)
      .set('Authorization', admin);
    expect(low.body.data).toHaveLength(1);
    expect(low.body.data[0].name).toBe('LowStock');
  });
});

describe('low-stock report (FR-RPT-02)', () => {
  it('lists at-or-below-threshold products with shortage', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    const admin = await loginAs(app, 'admin@example.com');
    await seedCatalog(app, admin);

    const res = await request(app).get(`${R}/low-stock`).set('Authorization', admin);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ name: 'LowStock', quantity: 3, shortage: 7 });
  });
});

describe('transactions report (FR-RPT-03, BR-40)', () => {
  it('requires both date bounds and rejects a span over 366 days', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    const admin = await loginAs(app, 'admin@example.com');

    const missing = await request(app)
      .get(`${R}/transactions?to=${TODAY}`)
      .set('Authorization', admin);
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('VALIDATION_ERROR');

    const oversized = await request(app)
      .get(`${R}/transactions?from=2024-01-01&to=2025-06-01`)
      .set('Authorization', admin);
    expect(oversized.status).toBe(400);
  });

  it('is byte-reproducible for a fixed range (BR-40)', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    const admin = await loginAs(app, 'admin@example.com');
    await seedCatalog(app, admin);

    const url = `${R}/transactions?from=${TODAY}&to=${TODAY}`;
    const first = await request(app).get(url).set('Authorization', admin);
    const second = await request(app).get(url).set('Authorization', admin);
    expect(first.status).toBe(200);
    expect(first.body.data.length).toBeGreaterThan(0);
    expect(second.body).toEqual(first.body);
  });
});

describe('product-performance report (FR-RPT-04)', () => {
  it('computes in/out/net per product plus overall totals', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    const admin = await loginAs(app, 'admin@example.com');
    await seedCatalog(app, admin);

    const res = await request(app)
      .get(`${R}/product-performance?from=${TODAY}&to=${TODAY}`)
      .set('Authorization', admin);
    expect(res.status).toBe(200);
    // P1: in 50+5=55, out 2, net 53 · P2: in 3, out 0, net 3
    expect(res.body.totals).toEqual({ totalIn: 58, totalOut: 2, totalNet: 56 });
    const p1 = res.body.data.find((r: { productName: string }) => r.productName === 'InStock');
    expect(p1).toMatchObject({ in: 55, out: 2, net: 53 });
  });
});

describe('consistency report (FR-RPT-05, Admin)', () => {
  it('flags drift when quantity diverges from the ledger sum', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    const admin = await loginAs(app, 'admin@example.com');
    const { p1 } = await seedCatalog(app, admin);

    // Induce drift out-of-band (the normal path can't): quantity != Σ ledger.
    await Product.updateOne({ _id: new Types.ObjectId(p1) }, { $set: { quantity: 999 } });

    const res = await request(app).get(`${R}/consistency`).set('Authorization', admin);
    expect(res.status).toBe(200);
    const drifted = res.body.data.find((r: { productName: string }) => r.productName === 'InStock');
    expect(drifted).toMatchObject({ quantity: 999, ledgerSum: 53, drift: true });
    const ok = res.body.data.find((r: { productName: string }) => r.productName === 'LowStock');
    expect(ok.drift).toBe(false);
  });
});

describe('CSV export (FR-RPT-06, ERR §7)', () => {
  it('streams text/csv with a header + one row per product (Admin)', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    const admin = await loginAs(app, 'admin@example.com');
    await seedCatalog(app, admin);

    const res = await request(app).get(`${R}/inventory/export`).set('Authorization', admin);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('inventory-report.csv');
    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toBe('SKU,Name,Category,Quantity,Cost price,Line value,Status');
    expect(lines).toHaveLength(3); // header + 2 products
  });

  it('rejects an unknown report name with 400', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    const admin = await loginAs(app, 'admin@example.com');
    const res = await request(app).get(`${R}/bogus/export`).set('Authorization', admin);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
