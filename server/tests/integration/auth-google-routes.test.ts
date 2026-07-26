/**
 * POST /api/v1/auth/google through the REAL pipeline (createApp) — the Google
 * sign-in surface (AAD). A STUB verifier is injected via the createApp test seam
 * (deps.verifyGoogleToken) so no real Google call is made; it stands in for
 * google-auth-library returning a decoded, trusted identity.
 *
 * Covers the four service branches: new user → provisions a workspace; existing
 * verified email → auto-links (googleSub attached, no duplicate); unverified
 * email → 401; and the "not configured" instance → 400. The new-user path
 * provisions inside a transaction, so this runs on a replica set (like signup).
 */
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp, type AppEnv } from '../../src/app.js';
import { createLogger } from '../../src/lib/logger.js';
import type { GoogleIdentity, GoogleVerifier } from '../../src/lib/googleVerify.js';
import { runAsSystem } from '../../src/lib/tenantContext.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { Organization } from '../../src/models/Organization.js';
import { RefreshToken } from '../../src/models/RefreshToken.js';
import { Settings } from '../../src/models/Settings.js';
import { User } from '../../src/models/User.js';
import { makeTestEnv } from '../helpers/testEnv.js';

const PASSWORD = 'sup3r-secret-pw';

let replSet: MongoMemoryReplSet;
const logger = createLogger('error', { write: () => undefined });

/** A verifier that always returns the given identity (ignores the raw token). */
function stubVerifier(identity: GoogleIdentity): GoogleVerifier {
  return () => Promise.resolve(identity);
}

function makeApp(verifyGoogleToken?: GoogleVerifier, overrides: Partial<AppEnv> = {}) {
  return createApp({
    logger,
    isReady: () => true,
    env: makeTestEnv(overrides),
    ...(verifyGoogleToken ? { verifyGoogleToken } : {}),
  });
}

/** Read a tenant-owned user without a request context (plugin fails closed). */
function findUser(email: string) {
  return runAsSystem(() => User.findOne({ email }).select('+passwordHash'));
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
  // System context bypasses tenant scoping so cleanup spans every tenant.
  await runAsSystem(async () => {
    await Promise.all([User.deleteMany({}), Settings.deleteMany({}), AuditLog.deleteMany({})]);
  });
  await Promise.all([Organization.deleteMany({}), RefreshToken.deleteMany({})]);
});

describe('POST /api/v1/auth/google', () => {
  it('first-time Google user: provisions a password-less workspace + returns a session', async () => {
    const identity: GoogleIdentity = {
      sub: 'google-sub-new',
      email: 'newbie@example.com',
      emailVerified: true,
      name: 'New Bie',
    };
    const res = await request(makeApp(stubVerifier(identity)))
      .post('/api/v1/auth/google')
      .send({ idToken: 'any-token' });

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['accessToken', 'settings', 'user']);
    expect(res.body.user.email).toBe('newbie@example.com');
    expect(res.body.user).not.toHaveProperty('passwordHash');

    // Hardened refresh cookie, same contract as password login.
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const cookie = cookies.find((c) => c.startsWith('refreshToken=')) as string;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/api/v1/auth');

    // The account is Google-provisioned: provider GOOGLE, googleSub set, NO password.
    const user = await findUser('newbie@example.com');
    expect(user?.authProvider).toBe('GOOGLE');
    expect(user?.googleSub).toBe('google-sub-new');
    expect(user?.passwordHash).toBeFalsy();
    expect(user?.role).toBe('ADMIN'); // the owner of their new workspace

    // A tenant (org + settings) was provisioned for them.
    const org = await Organization.findById(user?.tenantId);
    expect(org).not.toBeNull();
  });

  it('existing verified email: auto-links Google to the SAME account (no duplicate)', async () => {
    const email = `owner-${new Types.ObjectId().toHexString()}@example.com`;
    // Create a password account via the real signup flow.
    const signup = await request(makeApp())
      .post('/api/v1/auth/signup')
      .send({ organizationName: 'Acme', name: 'Owner', email, password: PASSWORD });
    expect(signup.status).toBe(201);
    const originalId = signup.body.user.id as string;

    // Google sign-in with the same (verified) email.
    const res = await request(
      makeApp(stubVerifier({ sub: 'google-sub-link', email, emailVerified: true })),
    )
      .post('/api/v1/auth/google')
      .send({ idToken: 'any-token' });

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(originalId); // same account, not a second one

    const user = await findUser(email);
    expect(user?.googleSub).toBe('google-sub-link'); // linked
    expect(user?.passwordHash).toBeTruthy(); // still has its original password
    const count = await runAsSystem(() => User.countDocuments({ email }));
    expect(count).toBe(1); // no duplicate account
  });

  it('unverified Google email is rejected (401) — linking requires email_verified', async () => {
    const res = await request(
      makeApp(
        stubVerifier({
          sub: 'google-sub-unv',
          email: 'unverified@example.com',
          emailVerified: false,
        }),
      ),
    )
      .post('/api/v1/auth/google')
      .send({ idToken: 'any-token' });

    expect(res.status).toBe(401);
    const created = await runAsSystem(() =>
      User.countDocuments({ email: 'unverified@example.com' }),
    );
    expect(created).toBe(0); // nothing provisioned
  });

  it('missing idToken → 400 VALIDATION_ERROR (before the verifier runs)', async () => {
    const res = await request(
      makeApp(stubVerifier({ sub: 's', email: 'x@example.com', emailVerified: true })),
    )
      .post('/api/v1/auth/google')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('Google sign-in not configured (no verifier / no GOOGLE_CLIENT_ID) → 400', async () => {
    const res = await request(makeApp()) // no verifier injected, env has no GOOGLE_CLIENT_ID
      .post('/api/v1/auth/google')
      .send({ idToken: 'any-token' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
