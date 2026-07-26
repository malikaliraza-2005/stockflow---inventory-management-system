/**
 * F6 T-c (jobs group) — the three scheduled jobs (TST §4): the A-8 lease guard
 * (single-execution, expired takeover, release), BR-18/ARB-05 reconciliation
 * drift detection, and the BEV-04 orphan sweep cross-reference. None use
 * transactions, so a plain memory server is enough.
 */
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { useTestTenant } from '../helpers/tenant.js';

import { acquireLease, releaseLease, withLease } from '../../src/jobs/lease.js';
import { runOrphanSweep } from '../../src/jobs/orphanSweep.js';
import { runReconciliation } from '../../src/jobs/reconciliation.js';
import type { CloudinaryAsset, CloudinaryClient } from '../../src/lib/cloudinary.js';
import { createLogger } from '../../src/lib/logger.js';
import { JobLock } from '../../src/models/JobLock.js';
import { Product } from '../../src/models/Product.js';
import { Transaction } from '../../src/models/Transaction.js';

let mongod: MongoMemoryServer;
const logger = createLogger('error', { write: () => undefined });

async function makeProduct(quantity: number, sku: string, images: { publicId: string }[] = []) {
  return Product.create({
    name: 'Widget',
    sku,
    categoryId: new Types.ObjectId(),
    costPrice: new mongoose.Types.Decimal128('1.00'),
    sellingPrice: new mongoose.Types.Decimal128('2.00'),
    quantity,
    lowStockThreshold: 5,
    isArchived: false,
    version: 0,
    images: images.map((i) => ({
      ...i,
      url: `https://res.cloudinary.com/${i.publicId}`,
      isPrimary: true,
    })),
  });
}

async function ledgerRow(productId: Types.ObjectId, quantityChange: number) {
  return Transaction.create({
    productId,
    type: 'STOCK_IN',
    quantityChange,
    quantityAfter: quantityChange,
    userId: new Types.ObjectId(),
  });
}

useTestTenant(); // SaaS: run every test in a fixed tenant context

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all([Product.init(), Transaction.init(), JobLock.init()]);
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

afterEach(async () => {
  await Promise.all([Product.deleteMany({}), Transaction.deleteMany({}), JobLock.deleteMany({})]);
});

describe('lease guard (A-8 / BEV-05)', () => {
  it('exactly one of two instances acquires the lease', async () => {
    const opts = { jobName: 'recon', leaseMs: 60_000, now: () => 1_000 };
    const [a, b] = await Promise.all([
      acquireLease({ ...opts, owner: 'instance-a' }),
      acquireLease({ ...opts, owner: 'instance-b' }),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await JobLock.countDocuments({ _id: 'recon' })).toBe(1);
  });

  it('a second acquire is refused while the lease is valid', async () => {
    const base = { jobName: 'sweep', leaseMs: 60_000, now: () => 1_000 };
    expect(await acquireLease({ ...base, owner: 'a' })).toBe(true);
    expect(await acquireLease({ ...base, owner: 'b' })).toBe(false);
  });

  it('an expired lease is taken over', async () => {
    expect(await acquireLease({ jobName: 'j', owner: 'a', leaseMs: 1_000, now: () => 0 })).toBe(
      true,
    );
    // now well past expiry (0 + 1000):
    expect(await acquireLease({ jobName: 'j', owner: 'b', leaseMs: 1_000, now: () => 5_000 })).toBe(
      true,
    );
    expect((await JobLock.findById('j'))?.owner).toBe('b');
  });

  it('withLease runs fn once as leader and releases the lease', async () => {
    let ran = 0;
    const executed = await withLease({ jobName: 'x', owner: 'a', leaseMs: 60_000 }, async () => {
      ran += 1;
    });
    expect(executed).toBe(true);
    expect(ran).toBe(1);
    expect(await JobLock.countDocuments({ _id: 'x' })).toBe(0); // released
  });

  it('release only removes a lease this owner holds', async () => {
    await acquireLease({ jobName: 'j', owner: 'a', leaseMs: 60_000, now: () => 0 });
    await releaseLease('j', 'someone-else'); // not the holder — no-op
    expect(await JobLock.countDocuments({ _id: 'j' })).toBe(1);
    await releaseLease('j', 'a');
    expect(await JobLock.countDocuments({ _id: 'j' })).toBe(0);
  });
});

describe('reconciliation (BR-18 / ARB-05)', () => {
  it('flags a product whose quantity != Σ ledger', async () => {
    const good = await makeProduct(8, 'GOOD-1');
    await ledgerRow(good._id, 8); // consistent
    const bad = await makeProduct(10, 'BAD-1');
    await ledgerRow(bad._id, 8); // drift: quantity 10 vs ledger 8

    const report = await runReconciliation({ logger });
    expect(report.checked).toBe(2);
    expect(report.drifted).toHaveLength(1);
    expect(report.drifted[0]).toMatchObject({ sku: 'BAD-1', quantity: 10, ledgerSum: 8 });
  });

  it('reports no drift when every product reconciles (incl. zero-ledger zero-quantity)', async () => {
    const p = await makeProduct(5, 'OK-1');
    await ledgerRow(p._id, 5);
    await makeProduct(0, 'EMPTY-1'); // no ledger rows; 0 == Σ∅
    const report = await runReconciliation({ logger });
    expect(report.drifted).toHaveLength(0);
  });
});

describe('orphan sweep (BEV-04)', () => {
  function fakeCloudinary(assets: CloudinaryAsset[]) {
    const destroyed: string[] = [];
    const client: Pick<CloudinaryClient, 'listFolder' | 'destroy'> = {
      listFolder: async () => assets,
      destroy: async (publicId) => {
        destroyed.push(publicId);
        return { result: 'ok' };
      },
    };
    return { client, destroyed };
  }

  it('destroys unreferenced assets older than 24h; keeps referenced and young ones', async () => {
    await makeProduct(1, 'IMG-1', [{ publicId: 'ims/prod/referenced' }]);
    const now = 100 * 24 * 60 * 60 * 1000; // 100 days in ms
    const old = new Date(now - 48 * 60 * 60 * 1000); // 48h ago
    const young = new Date(now - 1 * 60 * 60 * 1000); // 1h ago

    const { client, destroyed } = fakeCloudinary([
      { publicId: 'ims/prod/referenced', createdAt: old }, // referenced → keep
      { publicId: 'ims/prod/orphan-old', createdAt: old }, // orphan + old → destroy
      { publicId: 'ims/prod/orphan-young', createdAt: young }, // orphan + young → keep
    ]);

    const report = await runOrphanSweep({ cloudinary: client, logger, now: () => now });
    expect(destroyed).toEqual(['ims/prod/orphan-old']);
    expect(report).toMatchObject({ listed: 3, referenced: 1, destroyed: ['ims/prod/orphan-old'] });
  });

  it('destroys nothing when every asset is referenced', async () => {
    await makeProduct(1, 'IMG-2', [{ publicId: 'ims/prod/a' }, { publicId: 'ims/prod/b' }]);
    const now = 100 * 24 * 60 * 60 * 1000;
    const old = new Date(now - 48 * 60 * 60 * 1000);
    const { client, destroyed } = fakeCloudinary([
      { publicId: 'ims/prod/a', createdAt: old },
      { publicId: 'ims/prod/b', createdAt: old },
    ]);
    await runOrphanSweep({ cloudinary: client, logger, now: () => now });
    expect(destroyed).toHaveLength(0);
  });
});
