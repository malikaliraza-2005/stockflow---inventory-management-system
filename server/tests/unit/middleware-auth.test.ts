/**
 * F1 T-d — authenticate/authorize/validate against a SCRATCH app: this tier
 * can probe routes that don't exist yet (a protected non-auth route proves
 * the mustChangePassword fence 403s "everything else" — AAD §11.2 — before
 * F2 ships the first real one).
 */
import express from 'express';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createLogger } from '../../src/lib/logger.js';
import { signAccessToken } from '../../src/lib/tokens.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { User } from '../../src/models/User.js';
import { authenticate } from '../../src/middleware/authenticate.js';
import { createAuthorize } from '../../src/middleware/authorize.js';
import { createErrorHandler } from '../../src/middleware/errorHandler.js';
import { validate } from '../../src/middleware/validate.js';
import { AuditService } from '../../src/services/AuditService.js';
import { loginSchema } from '../../src/validation/schemas/auth.js';

const SECRET = 'middleware-test-secret-32-characters!';
let mongod: MongoMemoryServer;
const logger = createLogger('error', { write: () => undefined });

function buildScratchApp() {
  const app = express();
  app.use(express.json());
  const auth = authenticate(SECRET);
  const authorize = createAuthorize({ audit: new AuditService(logger) });

  app.get('/api/v1/protected', auth, (req, res) => {
    res.json({ id: req.user?._id.toString(), role: req.user?.role });
  });
  app.get('/api/v1/admin-only', auth, authorize('ADMIN'), (_req, res) => {
    res.json({ ok: true });
  });
  // Mount at one of the three ALLOWED paths to prove the fence lets it through
  app.post('/api/v1/auth/change-password', auth, (_req, res) => {
    res.status(204).end();
  });
  app.post('/api/v1/validated', validate(loginSchema), (req, res) => {
    res.json(req.body as Record<string, unknown>);
  });
  app.use(createErrorHandler(() => undefined));
  return app;
}

function tokenFor(id: Types.ObjectId | string, role: 'ADMIN' | 'STAFF' = 'STAFF'): string {
  return signAccessToken({ sub: id.toString(), role }, SECRET, '15m');
}

async function createUser(overrides: Partial<Record<string, unknown>> = {}) {
  return User.create({
    name: 'Sara An',
    email: 'sara@example.com',
    passwordHash: '$2b$04$0000000000000000000000000000000000000000000000000000',
    role: 'STAFF',
    mustChangePassword: false,
    ...overrides,
  });
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
  await Promise.all([User.deleteMany({}), AuditLog.deleteMany({})]);
});

describe('authenticate (#9 — AAD §5.1 chain)', () => {
  it('401 UNAUTHORIZED without a Bearer header', async () => {
    const res = await request(buildScratchApp()).get('/api/v1/protected');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('401 on garbage / forged tokens', async () => {
    const res = await request(buildScratchApp())
      .get('/api/v1/protected')
      .set('Authorization', 'Bearer not-a-jwt');
    expect(res.status).toBe(401);
  });

  it('401 when the token subject no longer exists', async () => {
    const res = await request(buildScratchApp())
      .get('/api/v1/protected')
      .set('Authorization', `Bearer ${tokenFor(new Types.ObjectId())}`);
    expect(res.status).toBe(401);
  });

  it('loads the LIVE user record onto req.user', async () => {
    const user = await createUser();
    const res = await request(buildScratchApp())
      .get('/api/v1/protected')
      .set('Authorization', `Bearer ${tokenFor(user._id)}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: user._id.toString(), role: 'STAFF' });
  });

  it('EC-17: deactivation takes effect within one request — 401 ACCOUNT_DEACTIVATED', async () => {
    const user = await createUser({ isActive: false });
    const res = await request(buildScratchApp())
      .get('/api/v1/protected')
      .set('Authorization', `Bearer ${tokenFor(user._id)}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('ACCOUNT_DEACTIVATED');
  });

  it('AAD§11.2__mustChangePassword_session_is_fenced_to_the_three_allowed_calls', async () => {
    const user = await createUser({ mustChangePassword: true });
    const app = buildScratchApp();
    const bearer = `Bearer ${tokenFor(user._id)}`;

    // Everything else → 403 with the DISTINCT reason (not the generic denial)
    const blocked = await request(app).get('/api/v1/protected').set('Authorization', bearer);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('FORBIDDEN');
    expect(blocked.body.error.message).toMatch(/password change required/i);

    // The allowed path passes the fence
    const allowed = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', bearer);
    expect(allowed.status).toBe(204);
  });
});

describe('authorize (#10 — §5 matrix + BEV-03)', () => {
  it('EC-17: role read from the DB record, not the token claim', async () => {
    const user = await createUser(); // STAFF in DB…
    const res = await request(buildScratchApp())
      .get('/api/v1/admin-only')
      .set('Authorization', `Bearer ${tokenFor(user._id, 'ADMIN')}`); // …forged ADMIN claim
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('grants when the DB role matches', async () => {
    const admin = await createUser({ email: 'admin@example.com', role: 'ADMIN' });
    const res = await request(buildScratchApp())
      .get('/api/v1/admin-only')
      .set('Authorization', `Bearer ${tokenFor(admin._id)}`);
    expect(res.status).toBe(200);
  });

  it('BEV-03__5_denials_in_window_emit_ONE_security_event', async () => {
    const user = await createUser();
    const app = buildScratchApp(); // one app instance = one denial window
    const bearer = `Bearer ${tokenFor(user._id)}`;

    for (let i = 0; i < 7; i += 1) {
      await request(app).get('/api/v1/admin-only').set('Authorization', bearer);
    }
    await expect
      .poll(() => AuditLog.countDocuments({ action: 'REPEATED_FORBIDDEN' }), { timeout: 2000 })
      .toBe(1); // exactly one per window, not one per denial
  });
});

describe('validate (#11 — §12.4)', () => {
  it('rejects with the VAL §9 details[] format and never reaches the handler', async () => {
    const res = await request(buildScratchApp())
      .post('/api/v1/validated')
      .send({ email: 'not-an-email', password: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const fields = (res.body.error.details as { field: string }[]).map((d) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['email', 'password']));
  });

  it('replaces the body with the parsed, normalized value', async () => {
    const res = await request(buildScratchApp())
      .post('/api/v1/validated')
      .send({ email: ' Admin@Example.COM ', password: 'x', extra: 'stripped' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ email: 'admin@example.com', password: 'x' });
  });
});
