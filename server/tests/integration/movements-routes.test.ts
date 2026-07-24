/**
 * F6 T-d — POST /inventory/movements through the REAL pipeline on a replica-set
 * memory server: the integration matrix (auth × role × validation × declared
 * errors × success shape), the validate-before-authorize exception (AAD §5.2),
 * and idempotent replay over the wire (ARB-02).
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
const MOVEMENTS = '/api/v1/inventory/movements';

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

/** Create a product at a given opening stock via the real /products route. */
async function createProduct(
  app: ReturnType<typeof makeApp>,
  admin: string,
  initialQuantity: number,
): Promise<string> {
  const res = await request(app).post('/api/v1/products').set('Authorization', admin).send({
    name: 'Widget',
    categoryId,
    costPrice: '10.00',
    sellingPrice: '15.50',
    initialQuantity,
  });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

function move(app: ReturnType<typeof makeApp>, auth: string, body: object, key = randomUUID()) {
  return request(app)
    .post(MOVEMENTS)
    .set('Authorization', auth)
    .set('Idempotency-Key', key)
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

describe('auth + idempotency-key preconditions', () => {
  it('401 without a token', async () => {
    const res = await request(makeApp())
      .post(MOVEMENTS)
      .set('Idempotency-Key', randomUUID())
      .send({ type: 'STOCK_IN', productId: new Types.ObjectId().toString(), quantity: 1 });
    expect(res.status).toBe(401);
  });

  it('400 VALIDATION_ERROR when the Idempotency-Key header is missing or malformed', async () => {
    const app = makeApp();
    await seedUser({ email: 'staff@example.com' });
    const staff = await loginAs(app, 'staff@example.com');
    const id = await createProduct(app, await adminAuth(app), 10);

    const missing = await request(app)
      .post(MOVEMENTS)
      .set('Authorization', staff)
      .send({ type: 'STOCK_IN', productId: id, quantity: 1 });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('VALIDATION_ERROR');

    const malformed = await request(app)
      .post(MOVEMENTS)
      .set('Authorization', staff)
      .set('Idempotency-Key', 'not-a-uuid')
      .send({ type: 'STOCK_IN', productId: id, quantity: 1 });
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.details[0].field).toBe('Idempotency-Key');
  });
});

describe('role matrix (§5.2 — validate-before-authorize, AAD §5.2)', () => {
  it('Staff may STOCK_IN/OUT but not ADJUSTMENT; Admin may adjust', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    await seedUser({ email: 'staff@example.com' });
    const admin = await loginAs(app, 'admin@example.com');
    const staff = await loginAs(app, 'staff@example.com');
    const id = await createProduct(app, admin, 20);

    expect((await move(app, staff, { type: 'STOCK_IN', productId: id, quantity: 5 })).status).toBe(
      200,
    );

    const staffAdjust = await move(app, staff, {
      type: 'ADJUSTMENT',
      productId: id,
      delta: -1,
      reason: 'DAMAGED',
    });
    expect(staffAdjust.status).toBe(403);
    expect(staffAdjust.body.error.code).toBe('FORBIDDEN');

    const adminAdjust = await move(app, admin, {
      type: 'ADJUSTMENT',
      productId: id,
      delta: -1,
      reason: 'DAMAGED',
    });
    expect(adminAdjust.status).toBe(200);
  });
});

describe('validation rows (§3.4)', () => {
  it('rejects INITIAL, missing amount, delta+counted together, and OTHER without a note', async () => {
    const app = makeApp();
    const admin = await adminAuth(app);
    const id = await createProduct(app, admin, 20);

    const initial = await move(app, admin, { type: 'INITIAL', productId: id, quantity: 1 });
    expect(initial.status).toBe(400);

    const noAmount = await move(app, admin, { type: 'STOCK_IN', productId: id });
    expect(noAmount.status).toBe(400);

    const both = await move(app, admin, {
      type: 'ADJUSTMENT',
      productId: id,
      delta: 1,
      countedQuantity: 5,
      reason: 'FOUND',
    });
    expect(both.status).toBe(400);

    const otherNoNote = await move(app, admin, {
      type: 'ADJUSTMENT',
      productId: id,
      delta: 1,
      reason: 'OTHER',
    });
    expect(otherNoNote.status).toBe(400);
  });
});

describe('success shape + declared error codes (§7.5)', () => {
  it('STOCK_IN returns the { transaction, product } contract', async () => {
    const app = makeApp();
    const admin = await adminAuth(app);
    const id = await createProduct(app, admin, 10);

    const res = await move(app, admin, {
      type: 'STOCK_IN',
      productId: id,
      quantity: 15,
      note: 'PO#7',
    });
    expect(res.status).toBe(200);
    expect(res.body.transaction).toMatchObject({
      productId: id,
      type: 'STOCK_IN',
      quantityChange: 15,
      quantityAfter: 25,
      note: 'PO#7',
    });
    expect(res.body.transaction.id).toBeDefined();
    expect(res.body.transaction.createdAt).toBeDefined();
    expect(res.body.product).toMatchObject({ id, quantity: 25, stockStatus: 'IN_STOCK' });
  });

  it('INSUFFICIENT_STOCK → 409 with details {available, requested}', async () => {
    const app = makeApp();
    const admin = await adminAuth(app);
    const id = await createProduct(app, admin, 5);

    const res = await move(app, admin, { type: 'STOCK_OUT', productId: id, quantity: 6 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(res.body.error.details).toEqual({ available: 5, requested: 6 });
  });

  it('PRODUCT_ARCHIVED → 409 on a movement against an archived product', async () => {
    const app = makeApp();
    const admin = await adminAuth(app);
    const id = await createProduct(app, admin, 0); // archive requires zero stock (T3)
    expect(
      (await request(app).post(`/api/v1/products/${id}/archive`).set('Authorization', admin))
        .status,
    ).toBe(200);

    const res = await move(app, admin, { type: 'STOCK_IN', productId: id, quantity: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PRODUCT_ARCHIVED');
  });
});

describe('idempotent replay over the wire (ARB-02)', () => {
  it('same key + same payload → identical 200, exactly one ledger row', async () => {
    const app = makeApp();
    const admin = await adminAuth(app);
    const id = await createProduct(app, admin, 30);
    const key = randomUUID();
    const body = { type: 'STOCK_OUT', productId: id, quantity: 10 };

    const first = await move(app, admin, body, key);
    const second = await move(app, admin, body, key);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.transaction.id).toBe(first.body.transaction.id);
    expect(second.body.product.quantity).toBe(20); // not decremented twice
    expect(await Transaction.countDocuments({ idempotencyKey: key })).toBe(1);
  });

  it('same key + different payload → 422 IDEMPOTENCY_CONFLICT', async () => {
    const app = makeApp();
    const admin = await adminAuth(app);
    const id = await createProduct(app, admin, 30);
    const key = randomUUID();

    await move(app, admin, { type: 'STOCK_OUT', productId: id, quantity: 10 }, key);
    const conflict = await move(
      app,
      admin,
      { type: 'STOCK_OUT', productId: id, quantity: 11 },
      key,
    );
    expect(conflict.status).toBe(422);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });
});

/** An Admin bearer token for tests that only need the privileged actor. */
async function adminAuth(app: ReturnType<typeof makeApp>): Promise<string> {
  await seedUser({
    email: `admin-${new Types.ObjectId().toHexString()}@example.com`,
    role: 'ADMIN',
  });
  const admin = await User.findOne({ role: 'ADMIN' }).sort({ createdAt: -1 });
  return loginAs(app, admin!.email);
}
