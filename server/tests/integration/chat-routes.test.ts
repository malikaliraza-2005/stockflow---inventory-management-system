/**
 * POST /chat through the REAL pipeline on a replica-set memory server, with a
 * SCRIPTED LLM injected at the `deps.llmProvider` seam — no network, no key, no
 * quota, and the whole rest of the stack (auth, tenant scoping, RBAC,
 * validation, serialization, error envelope) exercised for real.
 *
 *   - 401 unauthenticated · 200 for STAFF (chat.use is both-roles)
 *   - clean 404 when CHAT_ENABLED=false (the route is never mounted)
 *   - the answer body carries a SERVER-MINTED correlationId, never the
 *     client-supplied X-Correlation-Id (it is the feedback join key)
 *   - question bounds (VAL §2) and the 503 envelope on provider outage
 *   - TENANT ISOLATION: tenant A's question never returns tenant B's rows
 *
 * Tenants are born through the REAL public signup flow, and every request goes
 * over HTTP — the surface an attacker would actually use.
 */
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp, type AppEnv } from '../../src/app.js';
import { createLogger } from '../../src/lib/logger.js';
import { LlmProviderError } from '../../src/services/llm/types.js';
import { makeFakeProvider, makeFakeScript } from '../../src/services/llm/providers/fake.js';
import { makeTestEnv } from '../helpers/testEnv.js';

const PASSWORD = 'sup3r-secret-pw';
const CHAT = '/api/v1/chat';
const CONVERSATION_ID = '3f1c2b7a-0000-4000-8000-000000000001';

let replSet: MongoMemoryReplSet;
const logger = createLogger('error', { write: () => undefined });

function makeApp(responses: (string | Error)[] = [], env: Partial<AppEnv> = {}) {
  return createApp({
    logger,
    isReady: () => true,
    env: makeTestEnv(env),
    llmProvider: makeFakeProvider(makeFakeScript(responses)),
  });
}

type App = ReturnType<typeof makeApp>;

/** Public signup → a brand-new tenant + its auto-logged-in Admin bearer token. */
async function signupTenant(app: App, orgName: string) {
  const email = `owner-${new Types.ObjectId().toHexString()}@example.com`;
  const res = await request(app)
    .post('/api/v1/auth/signup')
    .send({ organizationName: orgName, name: 'Owner', email, password: PASSWORD });
  expect(res.status).toBe(201);
  return { bearer: `Bearer ${res.body.accessToken}`, email };
}

/** A STAFF member inside the caller's tenant — chat.use is a both-roles row. */
async function addStaff(app: App, adminBearer: string) {
  const email = `staff-${new Types.ObjectId().toHexString()}@example.com`;
  const created = await request(app)
    .post('/api/v1/users')
    .set('Authorization', adminBearer)
    .send({ name: 'Sara An', email, role: 'STAFF', temporaryPassword: PASSWORD });
  expect(created.status).toBe(201);

  // Invited users land with mustChangePassword — clear it so the session is usable.
  const login = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
  expect(login.status).toBe(200);
  const bearer = `Bearer ${login.body.accessToken}`;
  if (login.body.user.mustChangePassword === true) {
    const changed = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', bearer)
      .send({ currentPassword: PASSWORD, newPassword: `${PASSWORD}-2` });
    expect(changed.status).toBeLessThan(300);
    const relogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: `${PASSWORD}-2` });
    expect(relogin.status).toBe(200);
    return `Bearer ${relogin.body.accessToken}`;
  }
  return bearer;
}

async function seedProduct(app: App, bearer: string, name: string, initialQuantity: number) {
  const cat = await request(app)
    .post('/api/v1/categories')
    .set('Authorization', bearer)
    .send({ name: `Cat-${name.replace(/\W/g, '')}` });
  expect(cat.status).toBe(201);

  const prod = await request(app).post('/api/v1/products').set('Authorization', bearer).send({
    name,
    categoryId: cat.body.id,
    costPrice: '10.00',
    sellingPrice: '15.50',
    initialQuantity,
  });
  expect(prod.status).toBe(201);
  return prod.body.id as string;
}

function ask(app: App, auth: string, question: string) {
  return request(app)
    .post(CHAT)
    .set('Authorization', auth)
    .send({ conversationId: CONVERSATION_ID, question });
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
});

describe('auth + role (chat.use — both roles)', () => {
  it('401 without a token', async () => {
    const res = await request(makeApp())
      .post(CHAT)
      .send({ conversationId: CONVERSATION_ID, question: 'hi there' });
    expect(res.status).toBe(401);
  });

  it('200 for STAFF, answering from real data', async () => {
    const app = makeApp(['{"intent":"product_lookup","productQuery":"Dell"}']);
    const admin = await signupTenant(app, 'Acme Retail');
    await seedProduct(app, admin.bearer, 'Dell XPS 15', 7);
    const staff = await addStaff(app, admin.bearer);

    const res = await ask(app, staff, 'how many dell do we have');

    expect(res.status).toBe(200);
    expect(res.body.intent).toBe('product_lookup');
    expect(res.body.summary).toBe('Found 1 product matching "Dell". Total on hand: 7 units.');
    expect(res.body.products).toHaveLength(1);
    expect(res.body.products[0].quantity).toBe(7);
    // Money stays a 2-dp STRING all the way to the wire — never Number(price).
    expect(res.body.products[0].sellingPrice).toBe('15.50');
  });
});

describe('CHAT_ENABLED — the ship-dark switch', () => {
  it('the route is not mounted at all when the flag is off', async () => {
    const app = makeApp([], { CHAT_ENABLED: false });
    const admin = await signupTenant(app, 'Dark Co');

    const res = await ask(app, admin.bearer, 'how many laptops');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('the session payload tells the client whether to show the entry point', async () => {
    const on = makeApp();
    const admin = await signupTenant(on, 'Flag Co');
    const onRes = await request(on)
      .post('/api/v1/auth/login')
      .send({ email: admin.email, password: PASSWORD });
    expect(onRes.body.settings.chatEnabled).toBe(true);

    const off = makeApp([], { CHAT_ENABLED: false });
    const offRes = await request(off)
      .post('/api/v1/auth/login')
      .send({ email: admin.email, password: PASSWORD });
    expect(offRes.body.settings.chatEnabled).toBe(false);
  });
});

describe('request validation (VAL §2)', () => {
  it('rejects a too-short question, an oversized one, and a bad conversationId', async () => {
    const app = makeApp();
    const admin = await signupTenant(app, 'Validation Co');

    const short = await ask(app, admin.bearer, 'a');
    expect(short.status).toBe(400);
    expect(short.body.error.details[0].field).toBe('question');

    // RISK-5: without the cap, a pasted block becomes a multi-KB prompt and
    // token cost, latency and quota all scale with input we never meant to take.
    const huge = await ask(app, admin.bearer, 'x'.repeat(501));
    expect(huge.status).toBe(400);

    const badConversation = await request(app)
      .post(CHAT)
      .set('Authorization', admin.bearer)
      .send({ conversationId: 'not-a-uuid', question: 'how many laptops' });
    expect(badConversation.status).toBe(400);
  });
});

describe('the correlation id in the body is the feedback join key', () => {
  it('is minted SERVER-SIDE and ignores a client-supplied X-Correlation-Id', async () => {
    const app = makeApp(['{"intent":"unsupported"}']);
    const admin = await signupTenant(app, 'Corr Co');

    const res = await request(app)
      .post(CHAT)
      .set('Authorization', admin.bearer)
      .set('X-Correlation-Id', 'spoofed-by-the-client')
      .send({ conversationId: CONVERSATION_ID, question: "what's the weather" });

    expect(res.status).toBe(200);
    expect(res.body.correlationId).not.toBe('spoofed-by-the-client');
    expect(res.body.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.capabilities.length).toBeGreaterThan(0);
  });

  it('accepts a thumbs rating against it', async () => {
    const app = makeApp(['{"intent":"unsupported"}']);
    const admin = await signupTenant(app, 'Rating Co');
    const answer = await ask(app, admin.bearer, 'tell me a joke');

    const res = await request(app)
      .post(`${CHAT}/feedback`)
      .set('Authorization', admin.bearer)
      .send({ correlationId: answer.body.correlationId, rating: 'down' });

    expect(res.status).toBe(204);
  });
});

describe('provider outage is a clean 503, never a 500', () => {
  it('returns the SERVICE_UNAVAILABLE envelope with Retry-After', async () => {
    const app = makeApp([
      new LlmProviderError('quota exhausted', { retryable: false, status: 429 }),
    ]);
    const admin = await signupTenant(app, 'Outage Co');

    const res = await ask(app, admin.bearer, 'how many laptops');

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(res.headers['retry-after']).toBeDefined();
    expect(res.body.error.correlationId).toBeDefined();
  });
});

describe('tenant isolation (the SaaS invariant)', () => {
  it("tenant A's question never returns tenant B's rows", async () => {
    const app = makeApp(['{"intent":"product_lookup","productQuery":"Widget"}']);
    const a = await signupTenant(app, 'Alpha Retail');
    const b = await signupTenant(app, 'Beta Goods');
    await seedProduct(app, a.bearer, 'Alpha Widget', 3);
    await seedProduct(app, b.bearer, 'Beta Widget', 99);

    const res = await ask(app, a.bearer, 'show me widgets');

    expect(res.status).toBe(200);
    expect(res.body.totalCount).toBe(1);
    expect(res.body.products.map((p: { name: string }) => p.name)).toEqual(['Alpha Widget']);
    expect(JSON.stringify(res.body)).not.toContain('Beta Widget');
  });
});
