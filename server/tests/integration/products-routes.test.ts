/**
 * F4 T-d — the eight /products routes through the REAL pipeline on a
 * replica-set memory server: integration matrix rows (auth × role × validation
 * × declared errors × success shape), the full lifecycle, lookup precedence,
 * optimistic concurrency, and the ledger invariant surfaced over the wire.
 */
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

function newProduct(overrides: Record<string, unknown> = {}) {
  return { name: 'Widget', categoryId, costPrice: '10.00', sellingPrice: '15.50', ...overrides };
}

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

describe('role matrix (§5.2 — generated)', () => {
  it('Staff views but cannot manage/lifecycle; Admin passes', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    await seedUser({ email: 'staff@example.com' });
    const staff = await loginAs(app, 'staff@example.com');
    const admin = await loginAs(app, 'admin@example.com');
    const product = await request(app)
      .post('/api/v1/products')
      .set('Authorization', admin)
      .send(newProduct());
    const id = product.body.id;

    const staffView = await request(app).get('/api/v1/products').set('Authorization', staff);
    expect(staffView.status).toBe(200);

    const staffDenied = [
      request(app).post('/api/v1/products').set('Authorization', staff).send(newProduct()),
      request(app)
        .patch(`/api/v1/products/${id}`)
        .set('Authorization', staff)
        .send({ version: 0, name: 'X' }),
      request(app).post(`/api/v1/products/${id}/archive`).set('Authorization', staff),
      request(app).post(`/api/v1/products/${id}/restore`).set('Authorization', staff),
      request(app).delete(`/api/v1/products/${id}`).set('Authorization', staff),
    ];
    for (const res of await Promise.all(staffDenied)) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });
});

describe('POST /products (T2, BR-01…10)', () => {
  it('creates with auto-SKU + INITIAL ledger row; quantity == Σ ledger', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    const admin = await loginAs(app, 'admin@example.com');

    const res = await request(app)
      .post('/api/v1/products')
      .set('Authorization', admin)
      .send(newProduct({ initialQuantity: 25 }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      sku: 'ELEC-00001',
      quantity: 25,
      version: 0,
      costPrice: '10.00',
      sellingPrice: '15.50',
      stockStatus: 'IN_STOCK',
      categoryName: 'Electronics',
    });

    const sum = await Transaction.aggregate([
      { $match: { productId: new Types.ObjectId(res.body.id as string) } },
      { $group: { _id: null, s: { $sum: '$quantityChange' } } },
    ]);
    expect(sum[0]?.s).toBe(25); // == quantity
  });

  it('409 DUPLICATE_SKU / DUPLICATE_BARCODE; 400 on bad money', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    const admin = await loginAs(app, 'admin@example.com');
    await request(app)
      .post('/api/v1/products')
      .set('Authorization', admin)
      .send(newProduct({ sku: 'DUP-1', barcode: '111' }));

    const dupSku = await request(app)
      .post('/api/v1/products')
      .set('Authorization', admin)
      .send(newProduct({ sku: 'DUP-1' }));
    expect(dupSku.status).toBe(409);
    expect(dupSku.body.error.code).toBe('DUPLICATE_SKU');

    const dupBarcode = await request(app)
      .post('/api/v1/products')
      .set('Authorization', admin)
      .send(newProduct({ barcode: '111' }));
    expect(dupBarcode.status).toBe(409);
    expect(dupBarcode.body.error.code).toBe('DUPLICATE_BARCODE');

    const badMoney = await request(app)
      .post('/api/v1/products')
      .set('Authorization', admin)
      .send(newProduct({ costPrice: '10.999' }));
    expect(badMoney.status).toBe(400);
  });
});

describe('GET /products + /lookup', () => {
  it('list projections; archived filter is Admin-only (APD-02)', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    await seedUser({ email: 'staff@example.com' });
    const admin = await loginAs(app, 'admin@example.com');
    const staff = await loginAs(app, 'staff@example.com');
    await request(app).post('/api/v1/products').set('Authorization', admin).send(newProduct());

    const list = await request(app).get('/api/v1/products').set('Authorization', staff);
    expect(list.status).toBe(200);
    expect(list.body.data[0]).not.toHaveProperty('images'); // projection (NFR-05)
    expect(list.body.data[0]).not.toHaveProperty('version');

    const staffArchived = await request(app)
      .get('/api/v1/products?archived=true')
      .set('Authorization', staff);
    expect(staffArchived.status).toBe(403); // APD-02

    const adminArchived = await request(app)
      .get('/api/v1/products?archived=true')
      .set('Authorization', admin);
    expect(adminArchived.status).toBe(200);
  });

  it('lookup: barcode found, unknown 404, malformed 422', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    const admin = await loginAs(app, 'admin@example.com');
    await request(app)
      .post('/api/v1/products')
      .set('Authorization', admin)
      .send(newProduct({ barcode: '556677' }));

    const found = await request(app)
      .get('/api/v1/products/lookup?code=556677')
      .set('Authorization', admin);
    expect(found.status).toBe(200);
    expect(found.body).toMatchObject({ barcode: '556677', isArchived: false });

    const unknown = await request(app)
      .get('/api/v1/products/lookup?code=nope00')
      .set('Authorization', admin);
    expect(unknown.status).toBe(404);

    // > 64 chars is malformed per BR-16 → 422, not a not-found 404
    const malformed = await request(app)
      .get(`/api/v1/products/lookup?code=${'X'.repeat(65)}`)
      .set('Authorization', admin);
    expect(malformed.status).toBe(422);
    expect(malformed.body.error.code).toBe('INVALID_BARCODE');
  });
});

describe('PATCH /products/:id (BR-24) + lifecycle', () => {
  it('optimistic concurrency: correct version 200, stale version 409 STALE_WRITE', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    const admin = await loginAs(app, 'admin@example.com');
    const created = await request(app)
      .post('/api/v1/products')
      .set('Authorization', admin)
      .send(newProduct());
    const id = created.body.id;

    const ok = await request(app)
      .patch(`/api/v1/products/${id}`)
      .set('Authorization', admin)
      .send({ version: 0, name: 'Renamed' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ name: 'Renamed', version: 1 });

    const stale = await request(app)
      .patch(`/api/v1/products/${id}`)
      .set('Authorization', admin)
      .send({ version: 0, name: 'Nope' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('STALE_WRITE');
  });

  it('archive → 409 while stocked, 200 when empty; restore; hard-delete history guard', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    const admin = await loginAs(app, 'admin@example.com');
    const stocked = await request(app)
      .post('/api/v1/products')
      .set('Authorization', admin)
      .send(newProduct({ initialQuantity: 5 }));
    const empty = await request(app)
      .post('/api/v1/products')
      .set('Authorization', admin)
      .send(newProduct({ sku: 'EMP-1', initialQuantity: 0 }));

    const notEmpty = await request(app)
      .post(`/api/v1/products/${stocked.body.id}/archive`)
      .set('Authorization', admin);
    expect(notEmpty.status).toBe(409);
    expect(notEmpty.body.error.code).toBe('PRODUCT_NOT_EMPTY');

    const archived = await request(app)
      .post(`/api/v1/products/${empty.body.id}/archive`)
      .set('Authorization', admin);
    expect(archived.status).toBe(200);
    expect(archived.body.isArchived).toBe(true);

    const restored = await request(app)
      .post(`/api/v1/products/${empty.body.id}/restore`)
      .set('Authorization', admin);
    expect(restored.status).toBe(200);
    expect(restored.body.isArchived).toBe(false);

    // stocked product has an INITIAL row → hard delete blocked
    const del = await request(app)
      .delete(`/api/v1/products/${stocked.body.id}`)
      .set('Authorization', admin);
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('PRODUCT_HAS_HISTORY');

    // empty product has no ledger → deletable
    const delEmpty = await request(app)
      .delete(`/api/v1/products/${empty.body.id}`)
      .set('Authorization', admin);
    expect(delEmpty.status).toBe(204);
  });

  it('malformed :id → 400, unknown id → 404', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    const admin = await loginAs(app, 'admin@example.com');

    const malformed = await request(app)
      .get('/api/v1/products/not-an-id')
      .set('Authorization', admin);
    expect(malformed.status).toBe(400);

    const unknown = await request(app)
      .get(`/api/v1/products/${new Types.ObjectId().toHexString()}`)
      .set('Authorization', admin);
    expect(unknown.status).toBe(404);
  });
});

describe('POST /products with images (F5 — DBR-03 / VAL Issue 4)', () => {
  const image = (id: string, isPrimary: boolean) => ({
    publicId: `ims/prod/${id}`,
    url: `https://res.cloudinary.com/demo/${id}.jpg`,
    isPrimary,
  });

  it('accepts ≤5 with exactly one primary (201); rejects two-primary and out-of-folder publicId (400)', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    const admin = await loginAs(app, 'admin@example.com');

    const ok = await request(app)
      .post('/api/v1/products')
      .set('Authorization', admin)
      .send(newProduct({ images: [image('a', true), image('b', false)] }));
    expect(ok.status).toBe(201);
    expect(ok.body.images).toHaveLength(2);

    const twoPrimary = await request(app)
      .post('/api/v1/products')
      .set('Authorization', admin)
      .send(newProduct({ sku: 'IMG-2', images: [image('a', true), image('b', true)] }));
    expect(twoPrimary.status).toBe(400); // DBR-03

    const outsideFolder = await request(app)
      .post('/api/v1/products')
      .set('Authorization', admin)
      .send(
        newProduct({
          sku: 'IMG-3',
          images: [
            { publicId: 'evil/x', url: 'https://res.cloudinary.com/x.jpg', isPrimary: true },
          ],
        }),
      );
    expect(outsideFolder.status).toBe(400); // publicId anchor rejects traversal
  });
});
