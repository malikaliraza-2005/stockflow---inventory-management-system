/**
 * CategoryService — BR-26…28 (BEA §6, DBD §2.2/§4).
 *
 *  - BR-26: names unique case-insensitive; flat taxonomy. This service is the
 *    SINGLE HOME of category-name matching — the unique index carries the
 *    `{locale:'en', strength:2}` collation, so uniqueness is enforced by the
 *    index (no name pre-query needed; the index IS the authority — APR-08).
 *  - BR-27: delete is blocked while any product — active OR archived —
 *    references the category; `reassignTo` performs bulk reassignment first.
 *    The reference assertion + reassignment + delete are ONE atomic
 *    transaction (T5, DBD §4) with majority concerns.
 *  - BR-28: the system category (`isSystem`) is undeletable AND unmodifiable —
 *    it is a fixed anchor whose name is the seed's natural key (a rename would
 *    let a re-run create a second "Uncategorized").
 *
 * ── APR-08: duplicate name → VALIDATION_ERROR, not 409 ─────────────────────
 * Unlike SKU/email (SRS-mandated 409s), no SRS §16.3 409 exists for category
 * names. A duplicate — including the concurrent-create race that slips past
 * into the unique index — maps to VALIDATION_ERROR on the `name` field.
 *
 * ── The products collection (first-consumer note) ─────────────────────────
 * withCounts and the T5 reference check read the `products` collection, whose
 * Mongoose model lands in F4. CategoryService reaches it via the native driver
 * (same instrument as UserService's `appguards`) so F3 is self-contained:
 * before any product exists the counts are simply 0 and no reference blocks a
 * delete. The FULL delete-vs-assign conflict (BR-27 "validated in-transaction
 * where racy") closes when F4's product writes write-touch the category doc.
 */
import mongoose, { type HydratedDocument, type Types } from 'mongoose';

import { CategoryInUseError, NotFoundError, ValidationError } from '../errors/AppError.js';
import { listEnvelope, type ListEnvelope } from '../lib/pagination.js';
import { Category, CATEGORY_NAME_COLLATION, type CategoryDoc } from '../models/Category.js';
import { AuditService } from './AuditService.js';
import type { RequestContext } from './AuthService.js';
import type {
  CategoriesQuery,
  CategoryCreateInput,
  CategoryDeleteQuery,
  CategoryUpdateInput,
} from '../validation/schemas/categories.js';

const PRODUCTS_COLLECTION = 'products';
const MONGO_DUPLICATE_KEY = 11000;

/** List result: category docs plus, on `?withCounts=true`, a categoryId→count map. */
export interface CategoryListResult extends ListEnvelope<HydratedDocument<CategoryDoc>> {
  counts?: Map<string, number>;
}

export interface CategoryServiceDeps {
  audit: AuditService;
}

export class CategoryService {
  private readonly audit: AuditService;

  constructor(deps: CategoryServiceDeps) {
    this.audit = deps.audit;
  }

  /** GET /categories — §7.4; collation on the name sort keeps ordering
   *  case-insensitive AND index-backed (DBD §2.2). withCounts groups products
   *  by the page's category ids only (bounded IXSCAN on `{categoryId,…}`). */
  async list(query: CategoriesQuery): Promise<CategoryListResult> {
    const sortDir = query.order === 'asc' ? 1 : -1;
    let find = Category.find()
      .sort({ [query.sort]: sortDir, _id: 1 }) // _id tiebreak: stable pages
      .skip((query.page - 1) * query.limit)
      .limit(query.limit);
    if (query.sort === 'name') find = find.collation(CATEGORY_NAME_COLLATION);

    const [data, totalItems] = await Promise.all([find, Category.countDocuments()]);
    const envelope = listEnvelope(data, query.page, query.limit, totalItems);

    if (!query.withCounts) return envelope;
    const counts = await this.countProductsFor(data.map((c) => c._id));
    return { ...envelope, counts };
  }

  async getById(id: string): Promise<HydratedDocument<CategoryDoc>> {
    const category = await Category.findById(id);
    if (!category) throw new NotFoundError('Category not found.');
    return category;
  }

  /** POST /categories (BR-26) — race-safe duplicate handling via the collation
   *  unique index; APR-08 maps the collision to VALIDATION_ERROR. */
  async create(
    input: CategoryCreateInput,
    actorId: Types.ObjectId | string,
    ctx: RequestContext = {},
  ): Promise<HydratedDocument<CategoryDoc>> {
    let category: HydratedDocument<CategoryDoc>;
    try {
      category = await Category.create({
        name: input.name,
        ...(input.description !== undefined ? { description: input.description } : {}),
        isSystem: false, // server-set (BR-28) — never client-supplied
      });
    } catch (error) {
      throw this.mapDuplicateName(error);
    }

    await this.audit.record({
      actorId,
      entityType: 'CATEGORY',
      entityId: category._id,
      action: 'CREATE',
      entityLabel: category.name, // DN-4
      changes: [{ field: 'name', after: category.name }],
      ip: ctx.ip,
    });
    return category;
  }

  /** PATCH /categories/:id (BR-26) — replaces name + description; omitted
   *  description unsets. The system anchor is unmodifiable (BR-28). */
  async update(
    id: string,
    input: CategoryUpdateInput,
    actorId: Types.ObjectId | string,
    ctx: RequestContext = {},
  ): Promise<HydratedDocument<CategoryDoc>> {
    const category = await Category.findById(id);
    if (!category) throw new NotFoundError('Category not found.');
    if (category.isSystem) {
      throw new ValidationError([
        { field: 'id', message: 'The system category cannot be modified.' },
      ]);
    }

    const before = { name: category.name, description: category.description };
    category.name = input.name;
    category.set('description', input.description); // undefined → $unset (PATCH replace)
    const after = { name: category.name, description: category.description };
    const changes = AuditService.computeChanges(before, after, ['name', 'description']);

    try {
      await category.save();
    } catch (error) {
      throw this.mapDuplicateName(error);
    }

    if (changes.length > 0) {
      await this.audit.record({
        actorId,
        entityType: 'CATEGORY',
        entityId: category._id,
        action: 'UPDATE',
        entityLabel: category.name,
        changes,
        ip: ctx.ip,
      });
    }
    return category;
  }

  /**
   * DELETE /categories/:id — Boundary T5 (DBD §4): assert/reassign references +
   * delete + audit, ONE majority transaction.
   *
   * Disposition order:
   *   1. system category            → VALIDATION_ERROR (BR-28, undeletable)
   *   2. reassignTo present but bad  → VALIDATION_ERROR (identical / nonexistent)
   *   3. references remain, no valid reassignment → CATEGORY_IN_USE (409, BR-27)
   *   4. otherwise                   → 204
   */
  async delete(
    id: string,
    query: CategoryDeleteQuery,
    actorId: Types.ObjectId | string,
    ctx: RequestContext = {},
  ): Promise<void> {
    const products = this.productsCollection();
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(
        async () => {
          const category = await Category.findById(id).session(session);
          if (!category) throw new NotFoundError('Category not found.');
          if (category.isSystem) {
            throw new ValidationError([
              { field: 'id', message: 'The system category cannot be deleted.' },
            ]);
          }
          const categoryObjId = category._id;

          if (query.reassignTo) {
            const targetId = new mongoose.Types.ObjectId(query.reassignTo);
            if (targetId.equals(categoryObjId)) {
              throw new ValidationError([
                { field: 'reassignTo', message: 'Choose a different category to reassign to.' },
              ]);
            }
            const target = await Category.findById(targetId).session(session);
            if (!target) {
              throw new ValidationError([
                { field: 'reassignTo', message: 'That category no longer exists.' },
              ]);
            }
            await products.updateMany(
              { categoryId: categoryObjId },
              { $set: { categoryId: targetId } },
              { session },
            );
          }

          // The atomic BR-27 gate: any reference still standing blocks the delete.
          const remaining = await products.countDocuments(
            { categoryId: categoryObjId },
            { session },
          );
          if (remaining > 0) throw new CategoryInUseError();

          await category.deleteOne({ session });
          await this.audit.record(
            {
              actorId,
              entityType: 'CATEGORY',
              entityId: categoryObjId,
              action: 'DELETE',
              entityLabel: category.name, // DN-4: renders after the row is gone
              ip: ctx.ip,
            },
            { session },
          );
        },
        {
          readConcern: { level: 'majority' },
          writeConcern: { w: 'majority' }, // A-1 (ratified)
        },
      );
    } finally {
      await session.endSession();
    }
  }

  /** Product counts per category id (bounded to the given ids — index-backed). */
  private async countProductsFor(ids: Types.ObjectId[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>(ids.map((id) => [id.toString(), 0]));
    if (ids.length === 0) return counts;
    const grouped = await this.productsCollection()
      .aggregate<{ _id: Types.ObjectId; n: number }>([
        { $match: { categoryId: { $in: ids } } },
        { $group: { _id: '$categoryId', n: { $sum: 1 } } },
      ])
      .toArray();
    for (const row of grouped) counts.set(row._id.toString(), row.n);
    return counts;
  }

  private mapDuplicateName(error: unknown): unknown {
    if ((error as { code?: number }).code === MONGO_DUPLICATE_KEY) {
      return new ValidationError([
        { field: 'name', message: 'A category with this name already exists.' },
      ]);
    }
    return error;
  }

  private productsCollection() {
    const db = mongoose.connection.db;
    if (!db) throw new Error('CategoryService requires an active mongoose connection');
    return db.collection(PRODUCTS_COLLECTION);
  }
}
