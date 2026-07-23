/**
 * F1 T-d — the five /auth routes through the REAL pipeline (createApp):
 * integration matrix rows (auth × validation × declared errors × success
 * shape per the BEA §5 binding rows), cookie contract, security headers,
 * strict limiter, sanitization — and the FCM-01 tripwire.
 */
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/lib/logger.js';
import { generateOpaqueToken, hashToken } from '../../src/lib/tokens.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { RefreshToken } from '../../src/models/RefreshToken.js';
import { Settings } from '../../src/models/Settings.js';
import { User } from '../../src/models/User.js';
import { makeTestEnv } from '../helpers/testEnv.js';

const PASSWORD = 'correct-h0rse-battery';
const NEW_PASSWORD = 'brand-new-passw0rd';

let mongod: MongoMemoryServer;
const logger = createLogger('error', { write: () => undefined });

function makeApp(overrides = {}) {
  return createApp({ logger, isReady: () => true, env: makeTestEnv(overrides) });
}

async function seedUser(overrides: Partial<Record<string, unknown>> = {}) {
  return User.create({
    name: 'Sara An',
    email: 'sara@example.com',
    passwordHash: bcrypt.hashSync(PASSWORD, 4),
    role: 'STAFF',
    mustChangePassword: false,
    ...overrides,
  });
}

/** Extract the raw refresh token from the Set-Cookie header. */
function refreshCookieOf(res: request.Response): string {
  const cookies = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = cookies?.find((c) => c.startsWith('refreshToken='));
  expect(cookie, 'refresh Set-Cookie present').toBeDefined();
  return (cookie as string).split(';')[0]?.split('=')[1] as string;
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    RefreshToken.deleteMany({}),
    AuditLog.deleteMany({}),
    Settings.deleteMany({}),
  ]);
  // Non-default values so the FCM-01 assertion can't pass on fallbacks
  await Settings.create({
    currency: 'EUR',
    defaultLowStockThreshold: 10,
    movementWarningThreshold: 500,
  });
});

describe('POST /api/v1/auth/login (05 §7.1)', () => {
  it('200: exact success shape + hardened refresh cookie', async () => {
    await seedUser();
    const res = await request(makeApp())
      .post('/api/v1/auth/login')
      .send({ email: 'sara@example.com', password: PASSWORD });

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['accessToken', 'settings', 'user']);
    expect(res.body.user).toEqual({
      id: expect.any(String),
      name: 'Sara An',
      email: 'sara@example.com',
      role: 'STAFF',
      mustChangePassword: false,
    }); // no credential fields — structural exclusion (SEC-02)

    const cookies = res.headers['set-cookie'] as unknown as string[];
    const cookie = cookies.find((c) => c.startsWith('refreshToken=')) as string;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/api/v1/auth');
    expect(cookie).toMatch(/SameSite=Strict/i);

    expect(res.headers['x-correlation-id']).toBeTruthy(); // NFR-23
    expect(res.headers['x-frame-options']).toBeTruthy(); // helmet (SEC-05)
  });

  it('FCM-01__staff_currency_display — the session payload carries display constants', async () => {
    // The ratified FCM-01 contract (AAD §12): Staff has no other approved
    // endpoint for these — GET /settings stays Admin-only in the §5 matrix.
    await seedUser({ role: 'STAFF' });
    const res = await request(makeApp())
      .post('/api/v1/auth/login')
      .send({ email: 'sara@example.com', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.settings).toEqual({
      systemCurrency: 'EUR',
      movementWarningThreshold: 500,
    });
  });

  it('400 VALIDATION_ERROR with details[]; generic 401; 423 after 5 failures; 401 deactivated', async () => {
    await seedUser();
    const app = makeApp();

    const invalid = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nope', password: '' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
    expect(invalid.body.error.details.length).toBeGreaterThan(0);

    const unknown = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'ghost@example.com', password: PASSWORD });
    const wrong = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'sara@example.com', password: 'wrong-password-9' });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.error.message).toBe(wrong.body.error.message); // generic (AAD §2)

    for (let i = 0; i < 4; i += 1) {
      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'sara@example.com', password: 'wrong-password-9' });
    }
    const locked = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'sara@example.com', password: PASSWORD });
    expect(locked.status).toBe(423);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');

    await seedUser({ email: 'off@example.com', isActive: false });
    const deactivated = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'off@example.com', password: PASSWORD });
    expect(deactivated.status).toBe(401);
    expect(deactivated.body.error.code).toBe('ACCOUNT_DEACTIVATED');
  });

  it('SEC-06: $-operator payloads are sanitized into a 400, never a 500', async () => {
    const res = await request(makeApp())
      .post('/api/v1/auth/login')
      .send({ email: { $gt: '' }, password: { $ne: null } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('SEC-04: strict limiter → 429 RATE_LIMITED envelope', async () => {
    await seedUser();
    const app = makeApp({ RATE_LIMIT_STRICT_MAX: 3 });
    for (let i = 0; i < 3; i += 1) {
      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'sara@example.com', password: 'wrong-password-9' });
    }
    const limited = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'sara@example.com', password: PASSWORD });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('POST /api/v1/auth/refresh (05 §7.1, BR-35)', () => {
  it('200 rotates the cookie; replaying the old one kills the family', async () => {
    await seedUser();
    const app = makeApp();
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'sara@example.com', password: PASSWORD });
    const first = refreshCookieOf(login);

    const rotated = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refreshToken=${first}`);
    expect(rotated.status).toBe(200);
    expect(Object.keys(rotated.body).sort()).toEqual(['accessToken', 'settings', 'user']);
    const second = refreshCookieOf(rotated);
    expect(second).not.toBe(first);

    // Replay the rotated token → 401 + entire family revoked (BR-35)
    const replay = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refreshToken=${first}`);
    expect(replay.status).toBe(401);
    const familyDead = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refreshToken=${second}`);
    expect(familyDead.status).toBe(401);
  });

  it('401 without a cookie', async () => {
    const res = await request(makeApp()).post('/api/v1/auth/refresh');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('POST /api/v1/auth/logout (05 §7.1 — idempotent)', () => {
  it('204 revokes the session and expires the cookie', async () => {
    await seedUser();
    const app = makeApp();
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'sara@example.com', password: PASSWORD });
    const raw = refreshCookieOf(login);
    const bearer = `Bearer ${login.body.accessToken}`;

    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', bearer)
      .set('Cookie', `refreshToken=${raw}`);
    expect(res.status).toBe(204);
    const clearing = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('refreshToken='),
    );
    expect(clearing).toMatch(/Expires=Thu, 01 Jan 1970/); // cleared

    const reuse = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refreshToken=${raw}`);
    expect(reuse.status).toBe(401);

    // Idempotent: logging out again still succeeds (AAD §3.3)
    const again = await request(app).post('/api/v1/auth/logout').set('Authorization', bearer);
    expect(again.status).toBe(204);
  });

  it('401 without an access token', async () => {
    const res = await request(makeApp()).post('/api/v1/auth/logout');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/auth/reset-password (05 §7.1, UC-03)', () => {
  async function plantResetToken(email: string, expiresInMs = 30 * 60_000): Promise<string> {
    const raw = generateOpaqueToken();
    await User.updateOne(
      { email },
      {
        $set: {
          resetTokenHash: hashToken(raw),
          resetTokenExpiresAt: new Date(Date.now() + expiresInMs),
        },
      },
    );
    return raw;
  }

  it('204 installs the new password; token is single-use', async () => {
    await seedUser();
    const app = makeApp();
    const raw = await plantResetToken('sara@example.com');

    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: raw, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(204);

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'sara@example.com', password: NEW_PASSWORD });
    expect(login.status).toBe(200);

    const secondUse = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: raw, newPassword: 'another-passw0rd-1' });
    expect(secondUse.status).toBe(401);
  });

  it('400 policy violation · 401 unknown/expired token', async () => {
    await seedUser();
    const app = makeApp();
    const raw = await plantResetToken('sara@example.com');

    const weak = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: raw, newPassword: 'short' });
    expect(weak.status).toBe(400); // BR-32 enforced HERE, not at login

    const unknown = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: 'never-issued', newPassword: NEW_PASSWORD });
    expect(unknown.status).toBe(401);

    const expired = await plantResetToken('sara@example.com', -1000);
    const late = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: expired, newPassword: NEW_PASSWORD });
    expect(late.status).toBe(401);
  });
});

describe('POST /api/v1/auth/change-password (05 §7.1)', () => {
  it('204: new password live, other sessions dead, current session survives', async () => {
    await seedUser();
    const app = makeApp();
    const phone = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'sara@example.com', password: PASSWORD });
    const laptop = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'sara@example.com', password: PASSWORD });
    const laptopCookie = refreshCookieOf(laptop);

    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${laptop.body.accessToken}`)
      .set('Cookie', `refreshToken=${laptopCookie}`)
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(204);

    const phoneRefresh = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refreshToken=${refreshCookieOf(phone)}`);
    expect(phoneRefresh.status).toBe(401); // other session revoked

    const laptopRefresh = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refreshToken=${laptopCookie}`);
    expect(laptopRefresh.status).toBe(200); // presented session survives
  });

  it('401 wrong current password · 400 new === current · 401 unauthenticated', async () => {
    await seedUser();
    const app = makeApp();
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'sara@example.com', password: PASSWORD });
    const bearer = `Bearer ${login.body.accessToken}`;

    const wrong = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', bearer)
      .send({ currentPassword: 'wrong-password-9', newPassword: NEW_PASSWORD });
    expect(wrong.status).toBe(401);

    const same = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', bearer)
      .send({ currentPassword: PASSWORD, newPassword: PASSWORD });
    expect(same.status).toBe(400);

    const anonymous = await request(app)
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(anonymous.status).toBe(401);
  });

  it('mustChangePassword session CAN change its password (the allowed set)', async () => {
    await seedUser({ mustChangePassword: true });
    const app = makeApp();
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'sara@example.com', password: PASSWORD });
    expect(login.body.user.mustChangePassword).toBe(true);

    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(204);
    // The fence against NON-auth routes is proven in middleware-auth.test.ts —
    // no protected non-auth route exists until F2 (first-consumer law).
  });
});

describe('pipeline hardening', () => {
  it('SEC-06: oversized JSON body → 400 VALIDATION_ERROR, not an opaque 500', async () => {
    const res = await request(makeApp())
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send(`{"email":"a@b.co","password":"${'x'.repeat(1_100_000)}"}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('CORS: credentials allowed on /auth, origin pinned to the configured frontend', async () => {
    const res = await request(makeApp())
      .options('/api/v1/auth/login')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });
});
