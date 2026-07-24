/**
 * F4 T-c — ProductService + MovementService.recordInitial vs BR-01…10/21…25 on
 * a REPLICA-SET memory server (T2/T4 run real transactions). Load-bearing:
 *   - recordInitial atomicity + the invariant quantity == Σ ledger (BR-17)
 *   - SKU auto-generation (counter, PDV-02) + DUPLICATE_SKU/BARCODE mapping
 *   - optimistic concurrency (BR-24 → STALE_WRITE)
 *   - lifecycle T3/T4 (archive predicate, hard-delete history guard)
 *   - lookup precedence (BR-06/07) + INVALID_BARCODE
 */
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  DuplicateBarcodeError,
  DuplicateSkuError,
  InvalidBarcodeError,
  NotFoundError,
  ProductArchivedError,
  ProductHasHistoryError,
  ProductNotEmptyError,
  StaleWriteError,
  ValidationError,
} from '../../src/errors/AppError.js';
import { createLogger } from '../../src/lib/logger.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { Category } from '../../src/models/Category.js';
import { Product } from '../../src/models/Product.js';
import { Settings } from '../../src/models/Settings.js';
import { Transaction } from '../../src/models/Transaction.js';
import { AuditService } from '../../src/services/AuditService.js';
import { MovementService } from '../../src/services/MovementService.js';
import { ProductService } from '../../src/services/ProductService.js';
import { productsQuerySchema } from '../../src/validation/schemas/products.js';

let replSet: MongoMemoryReplSet;
const logger = createLogger('error', { write: () => undefined });
const actorId = new Types.ObjectId();
let categoryId: string;

function makeService(): ProductService {
  const audit = new AuditService(logger);
  return new ProductService({ audit, movement: new MovementService({ audit }) });
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Widget',
    categoryId,
    costPrice: '10.00',
    sellingPrice: '15.50',
    initialQuantity: 0,
    ...overrides,
  } as Parameters<ProductService['create']>[0];
}

function listQuery(overrides: Record<string, unknown> = {}) {
  return productsQuerySchema.parse(overrides);
}

async function ledgerSum(productId: Types.ObjectId): Promise<number> {
  const rows = await Transaction.aggregate<{ s: number }>([
    { $match: { productId } },
    { $group: { _id: null, s: { $sum: '$quantityChange' } } },
  ]);
  return rows[0]?.s ?? 0;
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  await Promise.all([Product.init(), Category.init()]);
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
    mongoose.connection.collection('counters').deleteMany({}),
  ]);
  await Settings.create({
    currency: 'USD',
    defaultLowStockThreshold: 10,
    movementWarningThreshold: 1000,
  });
  const cat = await Category.create({ name: 'Electronics' });
  categoryId = cat._id.toString();
});

describe('create / recordInitial (T2, BR-17)', () => {
  it('BR-17__zero_initial_quantity_writes_no_INITIAL_row', async () => {
    const service = makeService();
    const { product } = await service.create(baseInput({ initialQuantity: 0 }), actorId);
    expect(product.quantity).toBe(0);
    expect(await Transaction.countDocuments({ productId: product._id })).toBe(0);
    expect(await ledgerSum(product._id)).toBe(product.quantity); // 0 == 0
  });

  it('BR-17__non_zero_initial_quantity_writes_one_INITIAL_row; quantity == Σ ledger', async () => {
    const service = makeService();
    const { product } = await service.create(baseInput({ initialQuantity: 42 }), actorId);
    expect(product.quantity).toBe(42);

    const rows = await Transaction.find({ productId: product._id });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'INITIAL', quantityChange: 42, quantityAfter: 42 });
    expect(rows[0]?.idempotencyKey).toBeUndefined(); // PDV-04
    expect(await ledgerSum(product._id)).toBe(42);

    const audit = await AuditLog.findOne({ entityType: 'PRODUCT', action: 'CREATE' });
    expect(audit?.entityLabel).toContain(product.sku); // DN-4 name+SKU
  });

  it('BR-04__auto-generates a <PREFIX>-<00000> SKU from the category, and increments', async () => {
    const service = makeService();
    const a = await service.create(baseInput({ name: 'Aye' }), actorId);
    const b = await service.create(baseInput({ name: 'Bee' }), actorId);
    expect(a.product.sku).toBe('ELEC-00001'); // "Electronics" → ELEC (PDV-02)
    expect(b.product.sku).toBe('ELEC-00002');
  });

  it('honors a provided SKU (normalized uppercase) and rejects a bad category', async () => {
    const service = makeService();
    const { product } = await service.create(baseInput({ sku: 'abc-9' }), actorId);
    expect(product.sku).toBe('ABC-9');

    await expect(
      service.create(baseInput({ categoryId: new Types.ObjectId().toHexString() }), actorId),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('DUPLICATE_SKU and DUPLICATE_BARCODE (with conflict details, BR-05)', async () => {
    const service = makeService();
    await service.create(baseInput({ sku: 'DUP-1', barcode: '111' }), actorId);

    await expect(service.create(baseInput({ sku: 'DUP-1' }), actorId)).rejects.toBeInstanceOf(
      DuplicateSkuError,
    );

    const err = await service
      .create(baseInput({ barcode: '111' }), actorId)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DuplicateBarcodeError);
    expect((err as DuplicateBarcodeError).details).toMatchObject({ conflict: { sku: 'DUP-1' } });
  });

  it('copies lowStockThreshold from Settings when omitted (DN-3)', async () => {
    const service = makeService();
    const { product } = await service.create(baseInput(), actorId);
    expect(product.lowStockThreshold).toBe(10); // Settings default
  });
});

describe('update — optimistic concurrency (BR-24)', () => {
  it('BR-24__stale_version_is_rejected_with_STALE_WRITE', async () => {
    const service = makeService();
    const { product } = await service.create(baseInput(), actorId);
    expect(product.version).toBe(0);

    const first = await service.update(
      product._id.toString(),
      { version: 0, name: 'Renamed' },
      actorId,
    );
    expect(first.product.version).toBe(1);
    expect(first.product.name).toBe('Renamed');

    await expect(
      service.update(product._id.toString(), { version: 0, name: 'Again' }, actorId),
    ).rejects.toBeInstanceOf(StaleWriteError);
  });

  it('audits only changed fields and maps barcode collisions', async () => {
    const service = makeService();
    await service.create(baseInput({ sku: 'X-1', barcode: '900' }), actorId);
    const { product } = await service.create(baseInput({ sku: 'X-2' }), actorId);

    await service.update(product._id.toString(), { version: 0, sellingPrice: '20.00' }, actorId);
    const row = await AuditLog.findOne({ action: 'UPDATE', entityType: 'PRODUCT' });
    expect(row?.toObject().changes).toEqual([
      { field: 'sellingPrice', before: '15.50', after: '20.00' },
    ]);

    await expect(
      service.update(product._id.toString(), { version: 1, barcode: '900' }, actorId),
    ).rejects.toBeInstanceOf(DuplicateBarcodeError);
  });
});

describe('lifecycle — archive (T3) / restore / hard delete (T4)', () => {
  it('BR-22__archive_requires_zero_stock', async () => {
    const service = makeService();
    const empty = await service.create(baseInput({ initialQuantity: 0 }), actorId);
    const stocked = await service.create(baseInput({ initialQuantity: 5 }), actorId);

    const archived = await service.archive(empty.product._id.toString(), actorId);
    expect(archived.product.isArchived).toBe(true);

    await expect(service.archive(empty.product._id.toString(), actorId)).rejects.toBeInstanceOf(
      ProductArchivedError,
    ); // already archived

    await expect(service.archive(stocked.product._id.toString(), actorId)).rejects.toBeInstanceOf(
      ProductNotEmptyError,
    ); // quantity ≠ 0
  });

  it('restore is lossless; restoring a non-archived product is a 400', async () => {
    const service = makeService();
    const { product } = await service.create(baseInput({ initialQuantity: 0 }), actorId);
    await service.archive(product._id.toString(), actorId);

    const restored = await service.restore(product._id.toString(), actorId);
    expect(restored.product.isArchived).toBe(false);

    await expect(service.restore(product._id.toString(), actorId)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('BR-23__hard_delete_only_without_ledger_history', async () => {
    const service = makeService();
    const empty = await service.create(baseInput({ initialQuantity: 0 }), actorId); // no INITIAL row
    const withHistory = await service.create(baseInput({ initialQuantity: 3 }), actorId); // INITIAL row

    await service.hardDelete(empty.product._id.toString(), actorId);
    expect(await Product.findById(empty.product._id)).toBeNull();

    await expect(
      service.hardDelete(withHistory.product._id.toString(), actorId),
    ).rejects.toBeInstanceOf(ProductHasHistoryError);
    expect(await Product.findById(withHistory.product._id)).not.toBeNull();
  });
});

describe('lookup (BR-06/07)', () => {
  it('barcode primary, then SKU fallback; archived reported, unknown 404, malformed 422', async () => {
    const service = makeService();
    const { product } = await service.create(
      baseInput({ sku: 'LK-1', barcode: '556677' }),
      actorId,
    );

    expect((await service.lookup('556677'))._id.toString()).toBe(product._id.toString()); // barcode
    expect((await service.lookup('lk-1'))._id.toString()).toBe(product._id.toString()); // SKU, case-insens

    await service.archive(product._id.toString(), actorId); // qty 0 → archivable
    const arch = await service.lookup('556677');
    expect(arch.isArchived).toBe(true); // BR-07: reported, not hidden

    await expect(service.lookup('nope-000')).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.lookup('bad code')).rejects.toBeInstanceOf(InvalidBarcodeError);
  });
});

describe('list — filters (fallback search path)', () => {
  it('search by name/sku, category filter, and stockStatus', async () => {
    const service = makeService();
    await service.create(
      baseInput({ name: 'Alpha Cable', sku: 'CAB-1', initialQuantity: 0 }),
      actorId,
    ); // OUT
    await service.create(
      baseInput({ name: 'Beta Cable', sku: 'CAB-2', initialQuantity: 5 }),
      actorId,
    ); // LOW (≤10)
    await service.create(baseInput({ name: 'Gamma', sku: 'GAM-1', initialQuantity: 100 }), actorId); // IN

    const byName = await service.list(listQuery({ search: 'cable' }));
    expect(byName.totalItems).toBe(2);

    const outOfStock = await service.list(listQuery({ stockStatus: 'out' }));
    expect(outOfStock.data.map((p) => p.sku)).toEqual(['CAB-1']);

    const low = await service.list(listQuery({ stockStatus: 'low' }));
    expect(low.data.map((p) => p.sku)).toEqual(['CAB-2']);

    const inStock = await service.list(listQuery({ stockStatus: 'in' }));
    expect(inStock.data.map((p) => p.sku)).toEqual(['GAM-1']);

    const byCategory = await service.list(listQuery({ categoryId }));
    expect(byCategory.totalItems).toBe(3);
    expect(byCategory.categoryNames.get(categoryId)).toBe('Electronics');
  });

  it('archived products are excluded by default, included when asked', async () => {
    const service = makeService();
    const { product } = await service.create(baseInput({ initialQuantity: 0 }), actorId);
    await service.archive(product._id.toString(), actorId);

    expect((await service.list(listQuery())).totalItems).toBe(0); // active only
    expect((await service.list(listQuery({ archived: true }))).totalItems).toBe(1);
  });
});
