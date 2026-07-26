/**
 * SaaS multi-tenancy — the ISOLATION acceptance gate. Two tenants are born via
 * the REAL public signup flow, each acting only through its own auto-issued
 * session. The invariant under test: no request can read, mutate, or even count
 * another tenant's data. This is the single most important guarantee of the
 * conversion, so it is proven end-to-end through the HTTP pipeline (not via
 * direct model access) — exactly the surface a real attacker would use.
 */
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/lib/logger.js';
import { makeTestEnv } from '../helpers/testEnv.js';

const PASSWORD = 'sup3r-secret-pw';

let replSet: MongoMemoryReplSet;
const logger = createLogger('error', { write: () => undefined });

function makeApp() {
  return createApp({ logger, isReady: () => true, env: makeTestEnv() });
}

type App = ReturnType<typeof makeApp>;

/** Public signup → a brand-new tenant + its auto-logged-in Admin bearer token. */
async function signupTenant(app: App, orgName: string) {
  const email = `owner-${new Types.ObjectId().toHexString()}@example.com`;
  const res = await request(app)
    .post('/api/v1/auth/signup')
    .send({ organizationName: orgName, name: 'Owner', email, password: PASSWORD });
  expect(res.status).toBe(201);
  expect(res.body.accessToken).toBeTruthy();
  return { bearer: `Bearer ${res.body.accessToken}`, email };
}

/** Create a category and a product in the caller's tenant; return their ids + sku. */
async function seedProduct(app: App, bearer: string, categoryName: string) {
  const cat = await request(app)
    .post('/api/v1/categories')
    .set('Authorization', bearer)
    .send({ name: categoryName });
  expect(cat.status).toBe(201);

  const prod = await request(app).post('/api/v1/products').set('Authorization', bearer).send({
    name: 'Widget',
    categoryId: cat.body.id,
    costPrice: '10.00',
    sellingPrice: '15.50',
  });
  expect(prod.status).toBe(201);
  return { productId: prod.body.id as string, sku: prod.body.sku as string };
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
});

describe('tenant isolation (the SaaS acceptance gate)', () => {
  it('signup creates an isolated workspace: one tenant cannot see or touch another', async () => {
    const app = makeApp();
    const a = await signupTenant(app, 'Acme Retail');
    const b = await signupTenant(app, 'Beta Goods');

    const aProduct = await seedProduct(app, a.bearer, 'A-Widgets');
    const bProduct = await seedProduct(app, b.bearer, 'B-Widgets');

    // 1. Lists never span tenants.
    const aList = await request(app).get('/api/v1/products').set('Authorization', a.bearer);
    expect(aList.status).toBe(200);
    const aIds = (aList.body.data as Array<{ id: string }>).map((p) => p.id);
    expect(aIds).toContain(aProduct.productId);
    expect(aIds).not.toContain(bProduct.productId);
    expect(aList.body.totalItems).toBe(1);

    // 2. IDOR-by-id: A cannot READ B's product (a valid id in another tenant → 404).
    const crossRead = await request(app)
      .get(`/api/v1/products/${bProduct.productId}`)
      .set('Authorization', a.bearer);
    expect(crossRead.status).toBe(404);

    // 3. IDOR-by-id: A cannot MUTATE B's product.
    const crossPatch = await request(app)
      .patch(`/api/v1/products/${bProduct.productId}`)
      .set('Authorization', a.bearer)
      .send({ name: 'Hijacked', version: 0 });
    expect(crossPatch.status).toBe(404);

    // 4. SKU counters are per-tenant: each tenant's FIRST product gets sequence
    //    00001 independently (a global counter would have made B's 00002),
    //    proving the counter key is tenant-scoped.
    expect(aProduct.sku).toMatch(/-00001$/);
    expect(bProduct.sku).toMatch(/-00001$/);
  });

  it('dashboard, and the users roster, are each scoped to the caller tenant', async () => {
    const app = makeApp();
    const a = await signupTenant(app, 'Acme Two');
    const b = await signupTenant(app, 'Beta Two');
    await seedProduct(app, a.bearer, 'A-Cat');
    await seedProduct(app, b.bearer, 'B-Cat-1');
    await seedProduct(app, b.bearer, 'B-Cat-2');

    // Dashboard totals count only the caller's own products.
    const aDash = await request(app)
      .get('/api/v1/dashboard/summary')
      .set('Authorization', a.bearer);
    expect(aDash.status).toBe(200);
    expect(aDash.body.totals.activeProducts).toBe(1);

    const bDash = await request(app)
      .get('/api/v1/dashboard/summary')
      .set('Authorization', b.bearer);
    expect(bDash.body.totals.activeProducts).toBe(2);

    // The users roster shows only the tenant's own members (its single owner).
    const aUsers = await request(app).get('/api/v1/users').set('Authorization', a.bearer);
    expect(aUsers.status).toBe(200);
    expect(aUsers.body.totalItems).toBe(1);
    expect((aUsers.body.data as Array<{ email: string }>)[0]?.email).toBe(a.email);
  });

  it('email is globally unique: a second signup with a taken email is a 409', async () => {
    const app = makeApp();
    const a = await signupTenant(app, 'Acme Three');
    const res = await request(app).post('/api/v1/auth/signup').send({
      organizationName: 'Impostor Inc',
      name: 'Nope',
      email: a.email,
      password: PASSWORD,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_EMAIL');
  });
});
