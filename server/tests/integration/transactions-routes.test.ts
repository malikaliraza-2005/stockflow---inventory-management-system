/**
 * F7 T-d — GET /transactions (the Stock Ledger read) through the REAL pipeline
 * on a replica-set memory server: role gate, the filter matrix (date/type/
 * product/user/include-archived), archived-badge rows (EC-16), pagination, and
 * the resolved product/user labels.
 */
import { randomUUID } from 'node:crypto';

import bcrypt from 'bcrypt';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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
const LEDGER = '/api/v1/transactions';

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
  initialQuantity: number,
  name = 'Widget',
): Promise<string> {
  const res = await request(app)
    .post('/api/v1/products')
    .set('Authorization', admin)
    .send({ name, categoryId, costPrice: '10.00', sellingPrice: '15.50', initialQuantity });
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

describe('auth', () => {
  it('401 without a token', async () => {
    expect((await request(makeApp()).get(LEDGER)).status).toBe(401);
  });

  it('both roles may read the ledger (transactions.view)', async () => {
    const app = makeApp();
    await seedUser({ email: 'staff@example.com' });
    const staff = await loginAs(app, 'staff@example.com');
    expect((await request(app).get(LEDGER).set('Authorization', staff)).status).toBe(200);
  });
});

describe('ledger rows + labels', () => {
  it('returns resolved product/user labels and the INITIAL + movement rows', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN', name: 'Admin One' });
    const admin = await loginAs(app, 'admin@example.com');
    const id = await createProduct(app, admin, 10, 'USB Cable');
    await move(app, admin, { type: 'STOCK_IN', productId: id, quantity: 5 });

    const res = await request(app).get(LEDGER).set('Authorization', admin);
    expect(res.status).toBe(200);
    expect(res.body.totalItems).toBe(2); // INITIAL + STOCK_IN
    const row = res.body.data.find((r: { type: string }) => r.type === 'STOCK_IN');
    expect(row).toMatchObject({
      productName: 'USB Cable',
      productArchived: false,
      quantityChange: 5,
      quantityAfter: 15,
      userName: 'Admin One',
    });
    expect(row.productSku).toMatch(/^[A-Z]/);
  });
});

describe('filters (§7.6)', () => {
  it('type filter narrows to one movement kind', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    const admin = await loginAs(app, 'admin@example.com');
    const id = await createProduct(app, admin, 20);
    await move(app, admin, { type: 'STOCK_IN', productId: id, quantity: 5 });
    await move(app, admin, { type: 'STOCK_OUT', productId: id, quantity: 3 });

    const res = await request(app).get(`${LEDGER}?type=STOCK_OUT`).set('Authorization', admin);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].type).toBe('STOCK_OUT');
  });

  it('hides archived-product rows by default; includeArchived surfaces them with the badge', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    const admin = await loginAs(app, 'admin@example.com');
    const live = await createProduct(app, admin, 10, 'Live');
    const gone = await createProduct(app, admin, 5, 'Archived'); // INITIAL row, then emptied
    await move(app, admin, { type: 'STOCK_IN', productId: live, quantity: 1 });
    await move(app, admin, { type: 'STOCK_OUT', productId: gone, quantity: 5 }); // → 0, archivable
    expect(
      (await request(app).post(`/api/v1/products/${gone}/archive`).set('Authorization', admin))
        .status,
    ).toBe(200);

    // default: only the live product's rows (INITIAL 10 + STOCK_IN) — none for the archived product
    const hidden = await request(app).get(LEDGER).set('Authorization', admin);
    expect(hidden.body.data.every((r: { productArchived: boolean }) => !r.productArchived)).toBe(
      true,
    );

    // includeArchived=true surfaces the archived product's INITIAL row with the badge
    const shown = await request(app)
      .get(`${LEDGER}?includeArchived=true`)
      .set('Authorization', admin);
    const archivedRow = shown.body.data.find(
      (r: { productName: string }) => r.productName === 'Archived',
    );
    expect(archivedRow.productArchived).toBe(true);
  });

  it('paginates (05 §5 envelope)', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    const admin = await loginAs(app, 'admin@example.com');
    const id = await createProduct(app, admin, 100);
    for (let i = 0; i < 4; i += 1) {
      await move(app, admin, { type: 'STOCK_OUT', productId: id, quantity: 1 });
    }
    // 1 INITIAL + 4 STOCK_OUT = 5 rows
    const page1 = await request(app).get(`${LEDGER}?limit=2&page=1`).set('Authorization', admin);
    expect(page1.body).toMatchObject({ page: 1, limit: 2, totalItems: 5, totalPages: 3 });
    expect(page1.body.data).toHaveLength(2);
  });
});
