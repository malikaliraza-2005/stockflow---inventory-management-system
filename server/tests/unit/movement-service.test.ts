/**
 * F6 T-c — MovementService.recordMovement (T1) vs BR-11…20 on a REPLICA-SET
 * memory server (T1 runs real majority transactions). The M3 hard-gate suite —
 * the deepest tier (TST): the invariant `quantity == Σ ledger` must survive
 * concurrency, replay, and failed movements with no partial state.
 *
 *   - happy paths: STOCK_IN / STOCK_OUT / ADJUSTMENT (delta + counted); invariant
 *   - BR-11 INSUFFICIENT_STOCK (server-authoritative `available`); no partial state
 *   - archived / missing product classification
 *   - ARB-02 idempotency: replay-same → original; conflict-different → 422;
 *     concurrent duplicate-key → exactly one row, both replay
 *   - parallel-T1: N concurrent movements on ONE product — invariant holds, no oversell
 */
import { randomUUID } from 'node:crypto';

import mongoose, { Types, type HydratedDocument } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  IdempotencyConflictError,
  InsufficientStockError,
  ProductArchivedError,
  ValidationError,
} from '../../src/errors/AppError.js';
import { createLogger } from '../../src/lib/logger.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { Category } from '../../src/models/Category.js';
import { Product, type ProductDoc } from '../../src/models/Product.js';
import { Settings } from '../../src/models/Settings.js';
import { Transaction } from '../../src/models/Transaction.js';
import { AuditService } from '../../src/services/AuditService.js';
import { MovementService } from '../../src/services/MovementService.js';
import type { MovementInput } from '../../src/validation/schemas/movements.js';

let replSet: MongoMemoryReplSet;
const logger = createLogger('error', { write: () => undefined });
const actorId = new Types.ObjectId();
let categoryId: string;
let skuSeq = 0;

function makeService(): MovementService {
  return new MovementService({ audit: new AuditService(logger) });
}

async function ledgerSum(productId: Types.ObjectId): Promise<number> {
  const rows = await Transaction.aggregate<{ s: number }>([
    { $match: { productId } },
    { $group: { _id: null, s: { $sum: '$quantityChange' } } },
  ]);
  return rows[0]?.s ?? 0;
}

/** A product opened at `quantity` via the real T2 path (ledger already consistent). */
async function makeProduct(quantity: number): Promise<HydratedDocument<ProductDoc>> {
  skuSeq += 1;
  return makeService().recordInitial({
    product: {
      name: 'Widget',
      sku: `SKU-${String(skuSeq).padStart(5, '0')}`,
      categoryId: new Types.ObjectId(categoryId),
      costPrice: new mongoose.Types.Decimal128('10.00'),
      sellingPrice: new mongoose.Types.Decimal128('15.00'),
      lowStockThreshold: 10,
    },
    initialQuantity: quantity,
    actorId,
  });
}

/** Convenience: record a movement with a fresh idempotency key. */
function record(service: MovementService, input: MovementInput, key = randomUUID()) {
  return service.recordMovement({ idempotencyKey: key, input, actorId });
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  await Promise.all([Product.init(), Category.init(), Transaction.init()]); // idempotencyKey unique-sparse
});

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
});

beforeEach(async () => {
  await Promise.all([
    Product.deleteMany({}),
    Transaction.deleteMany({}),
    Category.deleteMany({}),
    Settings.deleteMany({}),
    AuditLog.deleteMany({}),
  ]);
  await Settings.create({
    currency: 'USD',
    defaultLowStockThreshold: 10,
    movementWarningThreshold: 1000,
  });
  const cat = await Category.create({ name: 'Electronics' });
  categoryId = cat._id.toString();
});

describe('happy paths — invariant quantity == Σ ledger (BR-17/19)', () => {
  it('BR-17__STOCK_IN_increments_and_records_a_ledger_row', async () => {
    const service = makeService();
    const product = await makeProduct(10);
    const { transaction, replayed } = await record(service, {
      type: 'STOCK_IN',
      productId: product._id.toString(),
      quantity: 25,
    });
    expect(replayed).toBe(false);
    expect(transaction.quantityChange).toBe(25);
    expect(transaction.quantityAfter).toBe(35);
    const fresh = await Product.findById(product._id);
    expect(fresh?.quantity).toBe(35);
    expect(await ledgerSum(product._id)).toBe(35);
  });

  it('BR-11__STOCK_OUT_decrements_within_available', async () => {
    const service = makeService();
    const product = await makeProduct(30);
    const { transaction } = await record(service, {
      type: 'STOCK_OUT',
      productId: product._id.toString(),
      quantity: 12,
      note: 'Order #1042',
    });
    expect(transaction.quantityChange).toBe(-12);
    expect(transaction.quantityAfter).toBe(18);
    expect(transaction.note).toBe('Order #1042');
    expect(await ledgerSum(product._id)).toBe(18);
  });

  it('BR-13__ADJUSTMENT_delta_applies_signed_change_with_reason', async () => {
    const service = makeService();
    const product = await makeProduct(20);
    const { transaction } = await record(service, {
      type: 'ADJUSTMENT',
      productId: product._id.toString(),
      delta: -3,
      reason: 'DAMAGED',
    });
    expect(transaction.quantityChange).toBe(-3);
    expect(transaction.quantityAfter).toBe(17);
    expect(transaction.reason).toBe('DAMAGED');
    expect(await ledgerSum(product._id)).toBe(17);
  });

  it('BR-13__ADJUSTMENT_counted_sets_absolute_and_derives_delta', async () => {
    const service = makeService();
    const product = await makeProduct(20);
    const { transaction } = await record(service, {
      type: 'ADJUSTMENT',
      productId: product._id.toString(),
      countedQuantity: 17,
      reason: 'COUNT_CORRECTION',
    });
    expect(transaction.quantityChange).toBe(-3); // 17 - 20
    expect(transaction.quantityAfter).toBe(17);
    expect(await ledgerSum(product._id)).toBe(17);
  });

  it('BR-12__ADJUSTMENT_counted_equal_to_current_is_a_no_op_rejection', async () => {
    const service = makeService();
    const product = await makeProduct(20);
    await expect(
      record(service, {
        type: 'ADJUSTMENT',
        productId: product._id.toString(),
        countedQuantity: 20,
        reason: 'COUNT_CORRECTION',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    // no partial state — no ledger row, quantity unchanged
    expect(await Transaction.countDocuments({ productId: product._id, type: 'ADJUSTMENT' })).toBe(
      0,
    );
    expect((await Product.findById(product._id))?.quantity).toBe(20);
  });
});

describe('BR-11 INSUFFICIENT_STOCK — server-authoritative, no partial state', () => {
  it('BR-11__STOCK_OUT_beyond_available_rejects_with_available_and_leaves_no_state', async () => {
    const service = makeService();
    const product = await makeProduct(5);
    const err = await record(service, {
      type: 'STOCK_OUT',
      productId: product._id.toString(),
      quantity: 6,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InsufficientStockError);
    expect((err as InsufficientStockError).details).toEqual({ available: 5, requested: 6 });
    // BR-19: partial state never observable
    expect((await Product.findById(product._id))?.quantity).toBe(5);
    expect(await Transaction.countDocuments({ productId: product._id, type: 'STOCK_OUT' })).toBe(0);
  });

  it('BR-13__negative_ADJUSTMENT_below_zero_is_INSUFFICIENT_STOCK', async () => {
    const service = makeService();
    const product = await makeProduct(2);
    await expect(
      record(service, {
        type: 'ADJUSTMENT',
        productId: product._id.toString(),
        delta: -5,
        reason: 'LOST',
      }),
    ).rejects.toBeInstanceOf(InsufficientStockError);
    expect((await Product.findById(product._id))?.quantity).toBe(2);
  });
});

describe('product state guards', () => {
  it('PRODUCT_ARCHIVED__movement_on_archived_product_rejects', async () => {
    const service = makeService();
    const product = await makeProduct(10);
    await Product.updateOne({ _id: product._id }, { $set: { isArchived: true } });
    await expect(
      record(service, { type: 'STOCK_IN', productId: product._id.toString(), quantity: 1 }),
    ).rejects.toBeInstanceOf(ProductArchivedError);
    expect(await Transaction.countDocuments({ productId: product._id, type: 'STOCK_IN' })).toBe(0);
  });
});

describe('ARB-02 idempotency / replay (BR-20)', () => {
  it('BR-20__replay_same_key_same_payload_returns_original_no_second_row', async () => {
    const service = makeService();
    const product = await makeProduct(30);
    const key = randomUUID();
    const input: MovementInput = {
      type: 'STOCK_OUT',
      productId: product._id.toString(),
      quantity: 10,
    };
    const first = await record(service, input, key);
    const second = await record(service, input, key);
    expect(second.replayed).toBe(true);
    expect(second.transaction._id.toString()).toBe(first.transaction._id.toString());
    // committed work never re-executed — one row, decremented once
    expect(await Transaction.countDocuments({ idempotencyKey: key })).toBe(1);
    expect((await Product.findById(product._id))?.quantity).toBe(20);
  });

  it('BR-20__same_key_different_payload_is_IDEMPOTENCY_CONFLICT', async () => {
    const service = makeService();
    const product = await makeProduct(30);
    const key = randomUUID();
    await record(
      service,
      { type: 'STOCK_OUT', productId: product._id.toString(), quantity: 10 },
      key,
    );
    await expect(
      record(service, { type: 'STOCK_OUT', productId: product._id.toString(), quantity: 11 }, key),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    // the conflicting attempt wrote nothing
    expect(await Transaction.countDocuments({ idempotencyKey: key })).toBe(1);
    expect((await Product.findById(product._id))?.quantity).toBe(20);
  });

  it('ARB-02__concurrent_same_key_commits_exactly_once_both_replay', async () => {
    const service = makeService();
    const product = await makeProduct(50);
    const key = randomUUID();
    const input: MovementInput = {
      type: 'STOCK_OUT',
      productId: product._id.toString(),
      quantity: 7,
    };
    const results = await Promise.all(Array.from({ length: 6 }, () => record(service, input, key)));
    // exactly one ledger row; product decremented exactly once
    expect(await Transaction.countDocuments({ idempotencyKey: key })).toBe(1);
    expect((await Product.findById(product._id))?.quantity).toBe(43);
    const ids = new Set(results.map((r) => r.transaction._id.toString()));
    expect(ids.size).toBe(1); // all callers saw the same committed movement
  });
});

describe('parallel-T1 concurrency — the invariant under contention (R-2)', () => {
  it('INV__N_concurrent_distinct_movements_keep_quantity_equal_to_ledger_sum', async () => {
    const service = makeService();
    const product = await makeProduct(100);

    // 20 distinct submissions (distinct keys) racing on ONE product: a mix of
    // ins and outs. Each is its own idempotent operation.
    const ops = Array.from({ length: 20 }, (_unused, i) =>
      record(service, {
        type: i % 2 === 0 ? 'STOCK_IN' : 'STOCK_OUT',
        productId: product._id.toString(),
        quantity: 3,
      }),
    );
    const settled = await Promise.allSettled(ops);
    const committed = settled.filter((s) => s.status === 'fulfilled').length;

    const fresh = await Product.findById(product._id);
    expect(fresh?.quantity).toBeGreaterThanOrEqual(0); // never oversold
    // the load-bearing assertion: materialized quantity == Σ ledger, always
    expect(fresh?.quantity).toBe(await ledgerSum(product._id));
    // every distinct key that committed produced exactly one row
    expect(await Transaction.countDocuments({ productId: product._id })).toBe(committed + 1); // +INITIAL
  });

  it('INV__concurrent_oversell_pressure_never_drives_quantity_negative', async () => {
    const service = makeService();
    const product = await makeProduct(10);
    // 10 concurrent STOCK_OUT of 3 each = demand 30 vs 10 on hand.
    const settled = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        record(service, { type: 'STOCK_OUT', productId: product._id.toString(), quantity: 3 }),
      ),
    );
    const ok = settled.filter((s) => s.status === 'fulfilled').length;
    expect(ok).toBe(3); // exactly 3 × 3 = 9 fit under 10; the rest hit INSUFFICIENT_STOCK
    const fresh = await Product.findById(product._id);
    expect(fresh?.quantity).toBe(1);
    expect(fresh?.quantity).toBe(await ledgerSum(product._id));
  });
});
