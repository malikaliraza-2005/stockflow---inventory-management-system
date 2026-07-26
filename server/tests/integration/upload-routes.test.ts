/**
 * F5 T-d — /upload routes through the REAL pipeline on a memory server.
 * Signature signing is LOCAL (no network); the folder-scope 403 short-circuits
 * before any Cloudinary call — both are exercisable offline. The in-folder
 * destroy (which would hit Cloudinary) is covered by the UploadService unit
 * test with a fake client.
 */
import bcrypt from 'bcrypt';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { useTestTenant } from '../helpers/tenant.js';

import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/lib/logger.js';
import { RefreshToken } from '../../src/models/RefreshToken.js';
import { Settings } from '../../src/models/Settings.js';
import { User } from '../../src/models/User.js';
import { makeTestEnv } from '../helpers/testEnv.js';

const PASSWORD = 'correct-h0rse-battery';

let mongod: MongoMemoryServer;
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
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), RefreshToken.deleteMany({}), Settings.deleteMany({})]);
  await Settings.create({
    currency: 'USD',
    defaultLowStockThreshold: 10,
    movementWarningThreshold: 1000,
  });
});

describe('POST /upload/signature', () => {
  it('Admin gets signed params; Staff is 403; bad type/size 400', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    await seedUser({ email: 'staff@example.com' });
    const admin = await loginAs(app, 'admin@example.com');
    const staff = await loginAs(app, 'staff@example.com');

    const ok = await request(app)
      .post('/api/v1/upload/signature')
      .set('Authorization', admin)
      .send({ contentType: 'image/png', size: 1024 });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      folder: 'ims/prod',
      cloudName: 'test-cloud',
      apiKey: 'test-key',
    });
    expect(typeof ok.body.signature).toBe('string');
    expect(typeof ok.body.timestamp).toBe('number');

    const denied = await request(app)
      .post('/api/v1/upload/signature')
      .set('Authorization', staff)
      .send({ contentType: 'image/png', size: 1024 });
    expect(denied.status).toBe(403);

    const badType = await request(app)
      .post('/api/v1/upload/signature')
      .set('Authorization', admin)
      .send({ contentType: 'image/gif', size: 1024 });
    expect(badType.status).toBe(400);

    const tooBig = await request(app)
      .post('/api/v1/upload/signature')
      .set('Authorization', admin)
      .send({ contentType: 'image/jpeg', size: 6 * 1024 * 1024 });
    expect(tooBig.status).toBe(400);
  });
});

describe('DELETE /upload/:publicId (APR-03 folder scope)', () => {
  it('a percent-encoded publicId outside ims/prod → 403 (no Cloudinary call)', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    const admin = await loginAs(app, 'admin@example.com');

    const outside = await request(app)
      .delete(`/api/v1/upload/${encodeURIComponent('other/folder/x')}`)
      .set('Authorization', admin);
    expect(outside.status).toBe(403);
    expect(outside.body.error.code).toBe('FORBIDDEN');
  });
});
