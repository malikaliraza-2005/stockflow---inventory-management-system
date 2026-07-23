/**
 * F2 T-d — the seven /users routes through the REAL pipeline on a replica-set
 * memory server: integration matrix rows (auth × role × validation × declared
 * errors × success shape), the reset-link path end-to-end, and F2's
 * acceptance criterion — a provisioned Staff account works immediately.
 */
import bcrypt from 'bcrypt';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/lib/logger.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { RefreshToken } from '../../src/models/RefreshToken.js';
import { Settings } from '../../src/models/Settings.js';
import { User } from '../../src/models/User.js';
import { makeTestEnv } from '../helpers/testEnv.js';

const PASSWORD = 'correct-h0rse-battery';
const TEMP_PASSWORD = 'temp-passw0rd-123';

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

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
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
    Settings.deleteMany({}),
  ]);
  await Settings.create({
    currency: 'USD',
    defaultLowStockThreshold: 10,
    movementWarningThreshold: 1000,
  });
});

describe('role matrix (§5.2 — generated, not hand-written)', () => {
  it('Staff → 403 FORBIDDEN on every users.manage row; Admin passes', async () => {
    const app = makeApp();
    const admin = await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    await seedUser({ email: 'staff@example.com' });
    const staffBearer = await loginAs(app, 'staff@example.com');
    const adminBearer = await loginAs(app, 'admin@example.com');

    const staffDenied = [
      request(app).get('/api/v1/users').set('Authorization', staffBearer),
      request(app).post('/api/v1/users').set('Authorization', staffBearer).send({}),
      request(app).get(`/api/v1/users/${admin._id}`).set('Authorization', staffBearer),
      request(app)
        .patch(`/api/v1/users/${admin._id}`)
        .set('Authorization', staffBearer)
        .send({ name: 'Hax' }),
      request(app)
        .post(`/api/v1/users/${admin._id}/reset-password`)
        .set('Authorization', staffBearer),
    ];
    for (const res of await Promise.all(staffDenied)) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }

    const adminList = await request(app).get('/api/v1/users').set('Authorization', adminBearer);
    expect(adminList.status).toBe(200);
    expect(adminList.body).toMatchObject({ page: 1, limit: 20, totalItems: 2, totalPages: 1 });
    for (const row of adminList.body.data) {
      expect(row).not.toHaveProperty('passwordHash'); // SEC-02 structural
      expect(row).not.toHaveProperty('failedLoginCount');
    }
  });

  it('/users/me is Any-role; the mustChangePassword fence 403s it with the distinct reason', async () => {
    const app = makeApp();
    await seedUser({ email: 'staff@example.com' });
    const staffBearer = await loginAs(app, 'staff@example.com');
    const me = await request(app).get('/api/v1/users/me').set('Authorization', staffBearer);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ email: 'staff@example.com', role: 'STAFF' });

    await seedUser({ email: 'flagged@example.com', mustChangePassword: true });
    const flaggedBearer = await loginAs(app, 'flagged@example.com');
    const fenced = await request(app).get('/api/v1/users/me').set('Authorization', flaggedBearer);
    expect(fenced.status).toBe(403);
    expect(fenced.body.error.message).toMatch(/password change required/i); // AAD §2
  });
});

describe('POST /users (BR-31) — F2 acceptance', () => {
  it('provisions a Staff account that WORKS IMMEDIATELY (forced change on)', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    const adminBearer = await loginAs(app, 'admin@example.com');

    const created = await request(app)
      .post('/api/v1/users')
      .set('Authorization', adminBearer)
      .send({
        name: 'New Staff',
        email: 'new-staff@example.com',
        role: 'STAFF',
        temporaryPassword: TEMP_PASSWORD,
      });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: 'New Staff',
      email: 'new-staff@example.com',
      role: 'STAFF',
      isActive: true,
    });

    // …works immediately: temp password logs in, session flags forced change
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'new-staff@example.com', password: TEMP_PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.user.mustChangePassword).toBe(true);
  });

  it('409 DUPLICATE_EMAIL · 400 policy on the temporary password', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    const adminBearer = await loginAs(app, 'admin@example.com');

    const dup = await request(app).post('/api/v1/users').set('Authorization', adminBearer).send({
      name: 'Twin',
      email: 'admin@example.com',
      role: 'STAFF',
      temporaryPassword: TEMP_PASSWORD,
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_EMAIL');

    const weak = await request(app)
      .post('/api/v1/users')
      .set('Authorization', adminBearer)
      .send({ name: 'Weak', email: 'weak@example.com', role: 'STAFF', temporaryPassword: 'short' });
    expect(weak.status).toBe(400); // BR-32 applies to provisioning too
  });
});

describe('PATCH /users/:id (T6) + param validation', () => {
  it('409 LAST_ADMIN when demoting the sole active admin', async () => {
    const app = makeApp();
    const admin = await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    const adminBearer = await loginAs(app, 'admin@example.com');

    const res = await request(app)
      .patch(`/api/v1/users/${admin._id}`)
      .set('Authorization', adminBearer)
      .send({ role: 'STAFF' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LAST_ADMIN');
  });

  it('deactivation kills the target session mid-flight (FR-USER-04) and audits the diff', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    const target = await seedUser({ email: 'staff@example.com' });
    const adminBearer = await loginAs(app, 'admin@example.com');
    const staffBearer = await loginAs(app, 'staff@example.com');

    const res = await request(app)
      .patch(`/api/v1/users/${target._id}`)
      .set('Authorization', adminBearer)
      .send({ isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);

    // EC-17: within one request — the target's next call 401s
    const dead = await request(app).get('/api/v1/users/me').set('Authorization', staffBearer);
    expect(dead.status).toBe(401);
    expect(dead.body.error.code).toBe('ACCOUNT_DEACTIVATED');

    const row = await AuditLog.findOne({ action: 'DEACTIVATE', entityId: target._id });
    expect(row?.toObject().changes).toEqual([{ field: 'isActive', before: true, after: false }]);
    expect(row?.entityLabel).toBe('staff@example.com');
  });

  it('malformed :id → 400 (universal preamble), unknown id → 404, empty body → 400', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    const adminBearer = await loginAs(app, 'admin@example.com');

    const malformed = await request(app)
      .get('/api/v1/users/not-an-id')
      .set('Authorization', adminBearer);
    expect(malformed.status).toBe(400);

    const unknown = await request(app)
      .get(`/api/v1/users/${new Types.ObjectId().toHexString()}`)
      .set('Authorization', adminBearer);
    expect(unknown.status).toBe(404);

    const empty = await request(app)
      .patch(`/api/v1/users/${new Types.ObjectId().toHexString()}`)
      .set('Authorization', adminBearer)
      .send({});
    expect(empty.status).toBe(400);
  });

  it('list validation: limit above the NFR-10 cap and unknown enum → 400', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    const adminBearer = await loginAs(app, 'admin@example.com');

    const overCap = await request(app)
      .get('/api/v1/users?limit=101')
      .set('Authorization', adminBearer);
    expect(overCap.status).toBe(400);

    const badRole = await request(app)
      .get('/api/v1/users?role=ROOT')
      .set('Authorization', adminBearer);
    expect(badRole.status).toBe(400);
  });
});

describe('reset-link path (UC-03 — end to end through both features)', () => {
  it('issue → link token completes the reset → target logs in with the new password', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    const target = await seedUser({ email: 'forgot@example.com' });
    const adminBearer = await loginAs(app, 'admin@example.com');

    const issued = await request(app)
      .post(`/api/v1/users/${target._id}/reset-password`)
      .set('Authorization', adminBearer);
    expect(issued.status).toBe(200);
    expect(issued.body.resetLink).toContain('/reset-password?token=');
    expect(new Date(issued.body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const token = new URL(issued.body.resetLink).searchParams.get('token') as string;
    const completed = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, newPassword: 'fresh-new-passw0rd' });
    expect(completed.status).toBe(204);

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'forgot@example.com', password: 'fresh-new-passw0rd' });
    expect(login.status).toBe(200);
    expect(login.body.user.mustChangePassword).toBe(false); // user chose it

    const audit = await AuditLog.countDocuments({
      action: { $in: ['PASSWORD_RESET_ISSUED', 'PASSWORD_RESET_COMPLETED'] },
    });
    expect(audit).toBe(2);
  });

  it('400 on an inactive target — an explicit operator mistake, not a 404', async () => {
    const app = makeApp();
    await seedUser({ email: 'admin@example.com', role: 'ADMIN' });
    const inactive = await seedUser({ email: 'gone@example.com', isActive: false });
    const adminBearer = await loginAs(app, 'admin@example.com');

    const res = await request(app)
      .post(`/api/v1/users/${inactive._id}/reset-password`)
      .set('Authorization', adminBearer);
    expect(res.status).toBe(400);
  });
});

describe('PATCH /users/me', () => {
  it('updates the name only and audits it; extraneous fields are stripped', async () => {
    const app = makeApp();
    const user = await seedUser({ email: 'staff@example.com', name: 'Old Name' });
    const bearer = await loginAs(app, 'staff@example.com');

    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', bearer)
      .send({ name: 'New Name', role: 'ADMIN', isActive: false }); // escalation attempt
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New Name');

    const fresh = await User.findById(user._id);
    expect(fresh?.role).toBe('STAFF'); // stripped — no self-escalation path
    expect(fresh?.isActive).toBe(true);
  });
});
