/**
 * F11 T-c — SettingsService vs BR-41 on a memory server. Covers the audit diff
 * path (entityType SETTINGS) and the no-op guard (an unchanged PUT audits
 * nothing). DN-3 (threshold reaches new products only) is proven end-to-end in
 * the integration suite, where products exist.
 */
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createLogger } from '../../src/lib/logger.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { Settings } from '../../src/models/Settings.js';
import { AuditService } from '../../src/services/AuditService.js';
import { SettingsService } from '../../src/services/SettingsService.js';
import { useTestTenant } from '../helpers/tenant.js';

let mongod: MongoMemoryServer;
const logger = createLogger('error', { write: () => undefined });
const actorId = new Types.ObjectId();

useTestTenant(); // SaaS: run every test in a fixed tenant context

function makeService(): SettingsService {
  return new SettingsService({ audit: new AuditService(logger) });
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
  await Promise.all([Settings.deleteMany({}), AuditLog.deleteMany({})]);
  await Settings.create({
    currency: 'USD',
    defaultLowStockThreshold: 10,
    movementWarningThreshold: 1000,
  });
});

describe('get (BR-41 singleton)', () => {
  it('returns the seeded singleton', async () => {
    const settings = await makeService().get();
    expect(settings.currency).toBe('USD');
    expect(settings.defaultLowStockThreshold).toBe(10);
  });
});

describe('update (audited via F2 diff path)', () => {
  it('applies changes and audits only the diffed fields (entityType SETTINGS)', async () => {
    const service = makeService();
    const updated = await service.update(
      { currency: 'EUR', defaultLowStockThreshold: 25, movementWarningThreshold: 1000 },
      actorId,
    );
    expect(updated.currency).toBe('EUR');
    expect(updated.defaultLowStockThreshold).toBe(25);

    const row = await AuditLog.findOne({ entityType: 'SETTINGS', action: 'UPDATE' });
    expect(row?.entityLabel).toBe('System Settings');
    expect(row?.toObject().changes).toEqual([
      { field: 'currency', before: 'USD', after: 'EUR' },
      { field: 'defaultLowStockThreshold', before: 10, after: 25 },
    ]); // movementWarningThreshold unchanged → omitted
  });

  it('a no-op PUT (identical values) writes no audit row', async () => {
    const service = makeService();
    await service.update(
      { currency: 'USD', defaultLowStockThreshold: 10, movementWarningThreshold: 1000 },
      actorId,
    );
    expect(await AuditLog.countDocuments({ entityType: 'SETTINGS' })).toBe(0);
  });

  it('updates the singleton in place — never creates a second document (BR-41)', async () => {
    const service = makeService();
    await service.update(
      { currency: 'GBP', defaultLowStockThreshold: 5, movementWarningThreshold: 500 },
      actorId,
    );
    expect(await Settings.countDocuments()).toBe(1);
  });
});
