/**
 * F1/F2 E2E — the M1 "Secure Shell" narrative through the REAL app on a
 * replica-set memory server (BEA §9 E2E tier; the login + reset/forced-change
 * flow "lands here with its feature" per phase-1-auth-users.md).
 *
 * One story, end to end:
 *   seed Admin → Admin provisions Staff → Staff first-login is fenced
 *   (mustChangePassword) → Staff changes password → Staff works → Admin resets
 *   Staff via the out-of-band link → Staff completes reset → logs in →
 *   Admin deactivates Staff → Staff is locked out within one request.
 */
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/lib/logger.js';
import { Settings } from '../../src/models/Settings.js';
import { User } from '../../src/models/User.js';
import { makeTestEnv } from '../helpers/testEnv.js';

const ADMIN_PW = 'admin-secret-pw-1';
const TEMP_PW = 'temp-passw0rd-1';
const STAFF_PW = 'staff-chosen-pw-9';
const RESET_PW = 'staff-reset-pw-42';

let replSet: MongoMemoryReplSet;
const logger = createLogger('error', { write: () => undefined });
const app = () => createApp({ logger, isReady: () => true, env: makeTestEnv() });

function cookieOf(res: request.Response): string {
  const cookies = res.headers['set-cookie'] as unknown as string[];
  return cookies.find((c) => c.startsWith('refreshToken=')) as string;
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  await Settings.create({
    currency: 'USD',
    defaultLowStockThreshold: 10,
    movementWarningThreshold: 1000,
  });
  await User.create({
    name: 'Administrator',
    email: 'admin@example.com',
    passwordHash: bcrypt.hashSync(ADMIN_PW, 4),
    role: 'ADMIN',
    mustChangePassword: false,
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
});

describe('M1 Secure Shell — full auth + user lifecycle', () => {
  it('runs the whole story end to end', async () => {
    const server = app();

    // 1. Admin signs in — FCM-01 display constants arrive in the payload
    const adminLogin = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password: ADMIN_PW });
    expect(adminLogin.status).toBe(200);
    expect(adminLogin.body.settings).toEqual({
      systemCurrency: 'USD',
      movementWarningThreshold: 1000,
    });
    const adminBearer = `Bearer ${adminLogin.body.accessToken}`;

    // 2. Admin provisions a Staff account (BR-31)
    const created = await request(server)
      .post('/api/v1/users')
      .set('Authorization', adminBearer)
      .send({
        name: 'Sara Staff',
        email: 'sara@example.com',
        role: 'STAFF',
        temporaryPassword: TEMP_PW,
      });
    expect(created.status).toBe(201);

    // 3. Staff first login works but is FENCED to the forced-change surface
    const firstLogin = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'sara@example.com', password: TEMP_PW });
    expect(firstLogin.status).toBe(200);
    expect(firstLogin.body.user.mustChangePassword).toBe(true);
    const fencedBearer = `Bearer ${firstLogin.body.accessToken}`;

    const fenced = await request(server).get('/api/v1/users/me').set('Authorization', fencedBearer);
    expect(fenced.status).toBe(403); // everything but change-password/logout/refresh

    // 4. Staff sets their own password → gate clears
    const changed = await request(server)
      .post('/api/v1/auth/change-password')
      .set('Authorization', fencedBearer)
      .set('Cookie', cookieOf(firstLogin))
      .send({ currentPassword: TEMP_PW, newPassword: STAFF_PW });
    expect(changed.status).toBe(204);

    // 5. Staff logs in fresh and now works
    const staffLogin = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'sara@example.com', password: STAFF_PW });
    expect(staffLogin.status).toBe(200);
    expect(staffLogin.body.user.mustChangePassword).toBe(false);
    const staffBearer = `Bearer ${staffLogin.body.accessToken}`;
    const me = await request(server).get('/api/v1/users/me').set('Authorization', staffBearer);
    expect(me.status).toBe(200);

    // Staff cannot reach Admin surfaces (§5 matrix)
    const denied = await request(server).get('/api/v1/users').set('Authorization', staffBearer);
    expect(denied.status).toBe(403);

    // 6. Admin issues an out-of-band reset (AS-6)
    const staff = await User.findOne({ email: 'sara@example.com' });
    const reset = await request(server)
      .post(`/api/v1/users/${staff!._id}/reset-password`)
      .set('Authorization', adminBearer);
    expect(reset.status).toBe(200);
    const token = new URL(reset.body.resetLink).searchParams.get('token') as string;

    // The reset revoked Staff's live session at issue
    const revoked = await request(server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieOf(staffLogin));
    expect(revoked.status).toBe(401);

    // 7. Staff completes the reset and logs in with the new password
    const completed = await request(server)
      .post('/api/v1/auth/reset-password')
      .send({ token, newPassword: RESET_PW });
    expect(completed.status).toBe(204);

    const afterReset = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'sara@example.com', password: RESET_PW });
    expect(afterReset.status).toBe(200);
    const afterResetBearer = `Bearer ${afterReset.body.accessToken}`;

    // 8. Admin deactivates Staff → next Staff request 401s within one request
    const deactivated = await request(server)
      .patch(`/api/v1/users/${staff!._id}`)
      .set('Authorization', adminBearer)
      .send({ isActive: false });
    expect(deactivated.status).toBe(200);

    const afterDeactivation = await request(server)
      .get('/api/v1/users/me')
      .set('Authorization', afterResetBearer);
    expect(afterDeactivation.status).toBe(401);
    expect(afterDeactivation.body.error.code).toBe('ACCOUNT_DEACTIVATED');

    // …and cannot log back in at all
    const blockedLogin = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'sara@example.com', password: RESET_PW });
    expect(blockedLogin.status).toBe(401);
  });
});
