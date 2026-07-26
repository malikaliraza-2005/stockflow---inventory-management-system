/**
 * F6 T-b — the `transactions` ledger index set + DBD §5 JSON-schema validator,
 * against ephemeral Mongo. Completion criteria (IMP-020 T-b): index behavior +
 * validator-rejection tests green.
 *
 * The `{idempotencyKey}` unique-SPARSE index is the movement-replay backstop
 * (ARB-02); the validator is the append-only (DES-1) second layer for writes
 * that bypass Mongoose (native driver / future migrations).
 */
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { TEST_TENANT_ID, useTestTenant } from '../helpers/tenant.js';

import { applyJsonValidators } from '../../src/models/jsonValidators.js';
import { Transaction } from '../../src/models/Transaction.js';

let mongod: MongoMemoryServer;
const DOC_VALIDATION_FAILURE = 121;

function validRow(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TEST_TENANT_ID, // SaaS: native rows must carry the tenant (validator requires it)
    productId: new Types.ObjectId(),
    type: 'STOCK_IN' as const,
    quantityChange: 5,
    quantityAfter: 5,
    userId: new Types.ObjectId(),
    ...overrides,
  };
}

useTestTenant(); // SaaS: run every test in a fixed tenant context

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Transaction.init(); // builds the unique-sparse idempotencyKey index
  await applyJsonValidators();
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

afterEach(async () => {
  await Transaction.deleteMany({});
});

describe('transactions indexes (DBD §2.4)', () => {
  it('declares the ledger filter/sort index set (tenant-leading — SaaS)', async () => {
    const keys = (await Transaction.collection.indexes()).map((i) => JSON.stringify(i.key));
    expect(keys).toContain(JSON.stringify({ tenantId: 1, productId: 1, createdAt: -1 }));
    expect(keys).toContain(JSON.stringify({ tenantId: 1, createdAt: -1 }));
    expect(keys).toContain(JSON.stringify({ tenantId: 1, userId: 1, createdAt: -1 }));
    expect(keys).toContain(JSON.stringify({ tenantId: 1, type: 1, createdAt: -1 }));
  });

  it('idempotencyKey index is per-tenant unique AND partial (ARB-02 backstop)', async () => {
    // A compound "sparse" index would not skip key-less rows (tenantId is always
    // present), so the movement-replay backstop is a PARTIAL unique index.
    const idx = (await Transaction.collection.indexes()).find(
      (i) => JSON.stringify(i.key) === JSON.stringify({ tenantId: 1, idempotencyKey: 1 }),
    );
    expect(idx?.unique).toBe(true);
    expect(idx?.partialFilterExpression).toEqual({ idempotencyKey: { $type: 'string' } });
  });

  it('rejects a duplicate idempotencyKey (BR-20)', async () => {
    await Transaction.create(validRow({ idempotencyKey: 'dup-key-1' }));
    await expect(
      Transaction.create(validRow({ idempotencyKey: 'dup-key-1' })),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('sparse: many rows WITHOUT a key coexist (INITIAL/compensations, PDV-04)', async () => {
    await Transaction.create(validRow({ type: 'INITIAL' }));
    await Transaction.create(validRow({ type: 'INITIAL' }));
    await Transaction.create(validRow({ type: 'ADJUSTMENT', reason: 'FOUND' }));
    expect(await Transaction.countDocuments({ idempotencyKey: { $exists: false } })).toBe(3);
  });
});

describe('transactions JSON validator — DBD §5 / §6 append-only (native writes)', () => {
  const db = () => mongoose.connection.db!;

  it('rejects a document carrying updatedAt (DES-1 — a ledger row is never edited)', async () => {
    await expect(
      db()
        .collection('transactions')
        .insertOne({ ...validRow(), createdAt: new Date(), updatedAt: new Date() }),
    ).rejects.toMatchObject({ code: DOC_VALIDATION_FAILURE });
  });

  it('rejects an out-of-set type that bypassed Mongoose (PDV-01)', async () => {
    await expect(
      db()
        .collection('transactions')
        .insertOne({ ...validRow(), type: 'TELEPORT', createdAt: new Date() }),
    ).rejects.toMatchObject({ code: DOC_VALIDATION_FAILURE });
  });

  it('rejects a negative quantityAfter (DN-2 snapshot ≥ 0)', async () => {
    await expect(
      db()
        .collection('transactions')
        .insertOne({ ...validRow(), quantityAfter: -1, createdAt: new Date() }),
    ).rejects.toMatchObject({ code: DOC_VALIDATION_FAILURE });
  });

  it('rejects an empty-string idempotencyKey (PDV-04 — must never reach the sparse index)', async () => {
    await expect(
      db()
        .collection('transactions')
        .insertOne({ ...validRow(), idempotencyKey: '', createdAt: new Date() }),
    ).rejects.toMatchObject({ code: DOC_VALIDATION_FAILURE });
  });

  it('accepts a well-formed movement row through the native driver', async () => {
    await db()
      .collection('transactions')
      .insertOne({ ...validRow(), idempotencyKey: 'ok-key', createdAt: new Date() });
    expect(await Transaction.countDocuments()).toBe(1);
  });
});
