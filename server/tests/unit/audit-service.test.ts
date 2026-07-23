/**
 * F1 T-c — AuditService core (IMP-020 Issue 2 slice): insert-only writer +
 * the fire-and-forget security-event path (AAD §7 — a failed audit write must
 * never fail the request that triggered it).
 */
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createLogger } from '../../src/lib/logger.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { AuditService } from '../../src/services/AuditService.js';

let mongod: MongoMemoryServer;
const warnLines: string[] = [];
const logger = createLogger('warn', {
  write: (line: string) => {
    warnLines.push(line);
  },
});
const service = new AuditService(logger);
const actorId = new Types.ObjectId();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

afterEach(async () => {
  await AuditLog.deleteMany({});
  warnLines.length = 0;
});

describe('AuditService (insert-only core + security-event path)', () => {
  it('record() appends a row with server-authoritative createdAt', async () => {
    await service.record({
      actorId,
      entityType: 'SECURITY',
      action: 'LOGIN_SUCCESS',
      entityLabel: 'admin@example.com',
      ip: '203.0.113.7',
    });
    const row = await AuditLog.findOne({ action: 'LOGIN_SUCCESS' });
    expect(row?.entityLabel).toBe('admin@example.com');
    expect(row?.createdAt).toBeInstanceOf(Date);
  });

  it('securityEvent() writes the row (awaitable in tests, voided by callers)', async () => {
    await service.securityEvent({
      actorId,
      entityType: 'SECURITY',
      action: 'TOKEN_REUSE_DETECTED',
      entityLabel: 'staff@example.com',
    });
    expect(await AuditLog.countDocuments({ action: 'TOKEN_REUSE_DETECTED' })).toBe(1);
  });

  it('securityEvent() NEVER rejects — a write failure degrades to a warn log (AAD §7)', async () => {
    await expect(
      service.securityEvent({
        actorId,
        entityType: 'SECURITY',
        // Out-of-catalog action → Mongoose enum rejection inside the service
        action: 'NOT_A_REAL_ACTION' as never,
        entityLabel: 'x',
      }),
    ).resolves.toBeUndefined();

    expect(await AuditLog.countDocuments({})).toBe(0);
    expect(warnLines.join('')).toContain('security event write failed');
  });

  it('exposes no update/delete surface (DES-1 — insert-only by construction)', () => {
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(service));
    expect(surface.sort()).toEqual(['constructor', 'record', 'securityEvent']);
  });
});
