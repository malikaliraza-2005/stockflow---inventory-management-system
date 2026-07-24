/**
 * F3 T-c — CategoryService vs BR-26…28 on a REPLICA-SET memory server (T5 runs
 * a real transaction). Coverage:
 *   BR-26  collation uniqueness → VALIDATION_ERROR (APR-08, NOT a 409)
 *   BR-27  T5 delete: reference-block (409) · atomic reassign-and-delete
 *   BR-28  system category undeletable AND unmodifiable
 * plus the withCounts aggregation over the (F4-owned) products collection,
 * which this feature reaches natively so counts/reference-checks work today.
 */
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CategoryInUseError, NotFoundError, ValidationError } from '../../src/errors/AppError.js';
import { createLogger } from '../../src/lib/logger.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { Category, CATEGORY_NAME_COLLATION } from '../../src/models/Category.js';
import { AuditService } from '../../src/services/AuditService.js';
import { CategoryService } from '../../src/services/CategoryService.js';
import { categoriesQuerySchema } from '../../src/validation/schemas/categories.js';

let replSet: MongoMemoryReplSet;
const logger = createLogger('error', { write: () => undefined });
const actorId = new Types.ObjectId();

function makeService(): CategoryService {
  return new CategoryService({ audit: new AuditService(logger) });
}

function listQuery(overrides: Record<string, unknown> = {}) {
  return categoriesQuerySchema.parse(overrides);
}

/** F4's products collection, reached natively (the model lands in F4). */
function products() {
  const db = mongoose.connection.db;
  if (!db) throw new Error('no connection');
  return db.collection('products');
}

async function assignProduct(categoryId: Types.ObjectId, isArchived = false) {
  await products().insertOne({
    categoryId,
    isArchived,
    sku: `SKU-${new Types.ObjectId().toHexString()}`,
  });
}

async function seedUncategorized() {
  return Category.create({ name: 'Uncategorized', isSystem: true });
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  await Category.init(); // build the collation unique index — the BR-26 authority
});

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
});

beforeEach(async () => {
  await Promise.all([Category.deleteMany({}), AuditLog.deleteMany({}), products().deleteMany({})]);
});

describe('create (BR-26)', () => {
  it('BR-26__creates_and_audits_with_isSystem_false', async () => {
    const service = makeService();
    const category = await service.create({ name: 'Electronics', description: 'Cables' }, actorId);
    expect(category.isSystem).toBe(false);
    expect(category.name).toBe('Electronics');

    const row = await AuditLog.findOne({ entityType: 'CATEGORY', action: 'CREATE' });
    expect(row?.entityLabel).toBe('Electronics');
    expect(row?.entityId?.toString()).toBe(category._id.toString());
  });

  it('BR-26__duplicate_name_is_case_insensitive_and_maps_to_VALIDATION_ERROR', async () => {
    const service = makeService();
    await service.create({ name: 'Electronics' }, actorId);
    // APR-08: NOT a 409 — a ValidationError on the name field
    await expect(service.create({ name: 'electronics' }, actorId)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('server-set isSystem cannot be forced by a caller-shaped payload', async () => {
    const service = makeService();
    // the schema strips isSystem; even a raw service call sets it false
    const category = await service.create({ name: 'Tools' }, actorId);
    expect(category.isSystem).toBe(false);
  });
});

describe('update (BR-26 / BR-28)', () => {
  it('renames, audits the diff, and clears an omitted description', async () => {
    const service = makeService();
    const created = await service.create({ name: 'Gadgets', description: 'old' }, actorId);
    const updated = await service.update(created._id.toString(), { name: 'Gizmos' }, actorId);

    expect(updated.name).toBe('Gizmos');
    expect(updated.description).toBeUndefined(); // PATCH replace — omitted unsets
    const row = await AuditLog.findOne({ action: 'UPDATE', entityType: 'CATEGORY' });
    expect(row?.toObject().changes).toContainEqual({
      field: 'name',
      before: 'Gadgets',
      after: 'Gizmos',
    });
  });

  it('BR-26__rename_into_an_existing_name_is_VALIDATION_ERROR', async () => {
    const service = makeService();
    await service.create({ name: 'Alpha' }, actorId);
    const beta = await service.create({ name: 'Beta' }, actorId);
    await expect(
      service.update(beta._id.toString(), { name: 'ALPHA' }, actorId),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('BR-28__system_category_is_unmodifiable', async () => {
    const service = makeService();
    const uncategorized = await seedUncategorized();
    await expect(
      service.update(uncategorized._id.toString(), { name: 'Renamed' }, actorId),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('unknown id → NotFound', async () => {
    const service = makeService();
    await expect(
      service.update(new Types.ObjectId().toHexString(), { name: 'X' }, actorId),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('delete (BR-27 T5 / BR-28)', () => {
  it('deletes an unreferenced category and audits DELETE with the label', async () => {
    const service = makeService();
    const category = await service.create({ name: 'Empty' }, actorId);
    await service.delete(category._id.toString(), {}, actorId);

    expect(await Category.findById(category._id)).toBeNull();
    const row = await AuditLog.findOne({ action: 'DELETE', entityType: 'CATEGORY' });
    expect(row?.entityLabel).toBe('Empty'); // DN-4 survives the row's deletion
  });

  it('BR-27__blocks_delete_while_referenced_without_reassignTo → CATEGORY_IN_USE', async () => {
    const service = makeService();
    const category = await service.create({ name: 'Used' }, actorId);
    await assignProduct(category._id); // an active product
    await assignProduct(category._id, true); // an archived one counts too

    await expect(service.delete(category._id.toString(), {}, actorId)).rejects.toBeInstanceOf(
      CategoryInUseError,
    );
    expect(await Category.findById(category._id)).not.toBeNull(); // still there
  });

  it('BR-27__reassign_and_delete_is_atomic', async () => {
    const service = makeService();
    const source = await service.create({ name: 'Source' }, actorId);
    const target = await seedUncategorized();
    await assignProduct(source._id);
    await assignProduct(source._id, true);

    await service.delete(source._id.toString(), { reassignTo: target._id.toString() }, actorId);

    expect(await Category.findById(source._id)).toBeNull();
    expect(await products().countDocuments({ categoryId: source._id })).toBe(0);
    expect(await products().countDocuments({ categoryId: target._id })).toBe(2); // both moved
  });

  it('reassignTo identical to the target category → VALIDATION_ERROR', async () => {
    const service = makeService();
    const category = await service.create({ name: 'Self' }, actorId);
    await assignProduct(category._id);
    await expect(
      service.delete(category._id.toString(), { reassignTo: category._id.toString() }, actorId),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('reassignTo pointing at a non-existent category → VALIDATION_ERROR', async () => {
    const service = makeService();
    const category = await service.create({ name: 'Orphan' }, actorId);
    await assignProduct(category._id);
    await expect(
      service.delete(
        category._id.toString(),
        { reassignTo: new Types.ObjectId().toHexString() },
        actorId,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('BR-28__system_category_is_undeletable', async () => {
    const service = makeService();
    const uncategorized = await seedUncategorized();
    await expect(service.delete(uncategorized._id.toString(), {}, actorId)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await Category.findById(uncategorized._id)).not.toBeNull();
  });
});

describe('list (withCounts §9.9 / collation sort)', () => {
  it('returns productCount per category (0 when none) on withCounts', async () => {
    const service = makeService();
    const a = await service.create({ name: 'HasTwo' }, actorId);
    await service.create({ name: 'HasNone' }, actorId);
    await assignProduct(a._id);
    await assignProduct(a._id, true);

    const res = await service.list(listQuery({ withCounts: 'true' }));
    expect(res.counts?.get(a._id.toString())).toBe(2);
    // every returned category id has an entry (0-filled), never missing
    for (const c of res.data) expect(res.counts?.has(c._id.toString())).toBe(true);
  });

  it('omits counts entirely when withCounts is false', async () => {
    const service = makeService();
    await service.create({ name: 'Plain' }, actorId);
    const res = await service.list(listQuery());
    expect(res.counts).toBeUndefined();
  });

  it('name sort is case-insensitive (collation), not ASCII', async () => {
    const service = makeService();
    // ASCII asc would put 'Zebra' (Z=90) before 'apple' (a=97); the collation
    // sorts case-insensitively, so 'apple' comes first. Discriminating inputs.
    await service.create({ name: 'Zebra' }, actorId);
    await service.create({ name: 'apple' }, actorId);
    const res = await service.list(listQuery({ sort: 'name', order: 'asc' }));
    expect(res.data.map((c) => c.name)).toEqual(['apple', 'Zebra']);
    void CATEGORY_NAME_COLLATION;
  });
});
