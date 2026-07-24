/**
 * F3 T-d — the five /categories routes through the REAL pipeline on a
 * replica-set memory server: integration matrix rows (auth × role × validation
 * × declared errors × success shape), the T5 delete/reassign path end-to-end,
 * and BR-28 (system category undeletable/unmodifiable).
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
import { RefreshToken } from '../../src/models/RefreshToken.js';
import { Settings } from '../../src/models/Settings.js';
import { User } from '../../src/models/User.js';
import { makeTestEnv } from '../helpers/testEnv.js';

const PASSWORD = 'correct-h0rse-battery';

let replSet: MongoMemoryReplSet;
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

function products() {
  const db = mongoose.connection.db;
  if (!db) throw new Error('no connection');
  return db.collection('products');
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  await Category.init(); // collation unique index (BR-26 authority)
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
    Settings.deleteMany({}),
    products().deleteMany({}),
  ]);
  await Settings.create({
    currency: 'USD',
    defaultLowStockThreshold: 10,
    movementWarningThreshold: 1000,
  });
});

describe('role matrix (§5.2 — generated)', () => {
  it('Staff views but cannot manage; Admin manages', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    await seedUser({ email: 'staff@example.com' });
    const staff = await loginAs(app, 'staff@example.com');
    const admin = await loginAs(app, 'admin@example.com');
    const cat = await Category.create({ name: 'Seed' });

    const staffView = await request(app).get('/api/v1/categories').set('Authorization', staff);
    expect(staffView.status).toBe(200); // categories.view = both roles

    const staffWrites = [
      request(app).post('/api/v1/categories').set('Authorization', staff).send({ name: 'X' }),
      request(app)
        .patch(`/api/v1/categories/${cat._id}`)
        .set('Authorization', staff)
        .send({ name: 'Y' }),
      request(app).delete(`/api/v1/categories/${cat._id}`).set('Authorization', staff),
    ];
    for (const res of await Promise.all(staffWrites)) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }

    const adminCreate = await request(app)
      .post('/api/v1/categories')
      .set('Authorization', admin)
      .send({ name: 'AdminMade' });
    expect(adminCreate.status).toBe(201);
  });
});

describe('POST /categories (BR-26)', () => {
  it('creates (201); duplicate name → 400 VALIDATION_ERROR, not 409 (APR-08)', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    const admin = await loginAs(app, 'admin@example.com');

    const created = await request(app)
      .post('/api/v1/categories')
      .set('Authorization', admin)
      .send({ name: 'Electronics', description: 'Cables' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: 'Electronics',
      description: 'Cables',
      isSystem: false,
    });

    const dup = await request(app)
      .post('/api/v1/categories')
      .set('Authorization', admin)
      .send({ name: 'electronics' }); // case-insensitive collision
    expect(dup.status).toBe(400);
    expect(dup.body.error.code).toBe('VALIDATION_ERROR');

    const short = await request(app)
      .post('/api/v1/categories')
      .set('Authorization', admin)
      .send({ name: 'x' });
    expect(short.status).toBe(400);
  });
});

describe('GET /categories (withCounts §9.9)', () => {
  it('paginates and, on withCounts, carries productCount', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    const admin = await loginAs(app, 'admin@example.com');
    const cat = await Category.create({ name: 'Counted' });
    await products().insertMany([
      { categoryId: cat._id, isArchived: false, sku: 'CNT-1' }, // unique sku: the
      { categoryId: cat._id, isArchived: true, sku: 'CNT-2' }, // {sku} unique index is real now (F4)
    ]);

    const res = await request(app)
      .get('/api/v1/categories?withCounts=true')
      .set('Authorization', admin);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, limit: 20, totalItems: 1 });
    expect(res.body.data[0].productCount).toBe(2);

    const noCounts = await request(app).get('/api/v1/categories').set('Authorization', admin);
    expect(noCounts.body.data[0]).not.toHaveProperty('productCount');
  });
});

describe('PATCH /categories/:id (BR-26 / BR-28)', () => {
  it('renames (200); system category → 400; malformed id → 400; unknown → 404', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    const admin = await loginAs(app, 'admin@example.com');
    const cat = await Category.create({ name: 'Old' });
    const system = await Category.create({ name: 'Uncategorized', isSystem: true });

    const renamed = await request(app)
      .patch(`/api/v1/categories/${cat._id}`)
      .set('Authorization', admin)
      .send({ name: 'New' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('New');

    const sys = await request(app)
      .patch(`/api/v1/categories/${system._id}`)
      .set('Authorization', admin)
      .send({ name: 'Renamed' });
    expect(sys.status).toBe(400);
    expect(sys.body.error.code).toBe('VALIDATION_ERROR');

    const malformed = await request(app)
      .patch('/api/v1/categories/not-an-id')
      .set('Authorization', admin)
      .send({ name: 'X' });
    expect(malformed.status).toBe(400);

    const unknown = await request(app)
      .patch(`/api/v1/categories/${new Types.ObjectId().toHexString()}`)
      .set('Authorization', admin)
      .send({ name: 'Valid' }); // passes schema → reaches the service → 404
    expect(unknown.status).toBe(404);
  });
});

describe('DELETE /categories/:id (BR-27 T5 / BR-28)', () => {
  it('unreferenced → 204', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    const admin = await loginAs(app, 'admin@example.com');
    const cat = await Category.create({ name: 'Empty' });

    const res = await request(app)
      .delete(`/api/v1/categories/${cat._id}`)
      .set('Authorization', admin);
    expect(res.status).toBe(204);
    expect(await Category.findById(cat._id)).toBeNull();
  });

  it('referenced without reassignTo → 409 CATEGORY_IN_USE', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    const admin = await loginAs(app, 'admin@example.com');
    const cat = await Category.create({ name: 'Used' });
    await products().insertOne({ categoryId: cat._id, isArchived: false });

    const res = await request(app)
      .delete(`/api/v1/categories/${cat._id}`)
      .set('Authorization', admin);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CATEGORY_IN_USE');
  });

  it('referenced with ?reassignTo → 204 and products move to the target', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    const admin = await loginAs(app, 'admin@example.com');
    const source = await Category.create({ name: 'Source' });
    const target = await Category.create({ name: 'Uncategorized', isSystem: true });
    await products().insertMany([
      { categoryId: source._id, isArchived: false, sku: 'RS-1' },
      { categoryId: source._id, isArchived: true, sku: 'RS-2' },
    ]);

    const res = await request(app)
      .delete(`/api/v1/categories/${source._id}?reassignTo=${target._id}`)
      .set('Authorization', admin);
    expect(res.status).toBe(204);
    expect(await Category.findById(source._id)).toBeNull();
    expect(await products().countDocuments({ categoryId: target._id })).toBe(2);
  });

  it('system category → 400 (undeletable); malformed reassignTo → 400', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    const admin = await loginAs(app, 'admin@example.com');
    const system = await Category.create({ name: 'Uncategorized', isSystem: true });
    const other = await Category.create({ name: 'Other' });

    const sys = await request(app)
      .delete(`/api/v1/categories/${system._id}`)
      .set('Authorization', admin);
    expect(sys.status).toBe(400);

    const badReassign = await request(app)
      .delete(`/api/v1/categories/${other._id}?reassignTo=not-an-id`)
      .set('Authorization', admin);
    expect(badReassign.status).toBe(400); // schema rejects the query param
  });
});
