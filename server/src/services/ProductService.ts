/**
 * ProductService — BR-01…10, 21…25 (BEA §6). Catalog lifecycle + the SKU
 * counter; delegates the T2 create to MovementService (the sole quantity/ledger
 * writer). Lifecycle boundaries: T2 (create), T3 (archive), T4 (hard delete).
 *
 * ── Optimistic concurrency (BR-24) ────────────────────────────────────────
 * Every mutating catalog op is a CONDITIONAL update keyed on `version`; a lost
 * race returns STALE_WRITE. Movements never write catalog fields, so they never
 * bump `version` and never collide with an edit.
 *
 * ── Search (D-1) ──────────────────────────────────────────────────────────
 * `search` uses the P0-blessed FALLBACK: case-insensitive anchored/contains
 * regex over name/sku/barcode (RDM R-6). The Atlas Search `$search` path (the
 * primary D-1 index — edge-gram over name/sku/barcode) is gated behind
 * `atlasSearch`; it cannot run on the in-memory/CI cluster, so the fallback is
 * the exercised path and the staging index is the enhancement.
 */
import mongoose, { type FilterQuery, type HydratedDocument, type Types } from 'mongoose';

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
} from '../errors/AppError.js';
import { escapeRegex, listEnvelope, type ListEnvelope } from '../lib/pagination.js';
import { Category } from '../models/Category.js';
import { Product, type ProductDoc } from '../models/Product.js';
import { Settings } from '../models/Settings.js';
import { Transaction } from '../models/Transaction.js';
import { AuditService } from './AuditService.js';
import type { MovementService } from './MovementService.js';
import type { RequestContext } from './AuthService.js';
import type {
  ProductCreateInput,
  ProductsQuery,
  ProductUpdateInput,
} from '../validation/schemas/products.js';

const MONGO_DUPLICATE_KEY = 11000;
const PRINTABLE_CODE = /^[\x20-\x7E]{1,64}$/; // BR-16
const DEFAULT_LOW_STOCK = 10; // Settings fallback only (the singleton is seeded)

export interface ProductListResult extends ListEnvelope<HydratedDocument<ProductDoc>> {
  categoryNames: Map<string, string>;
}

export interface ProductDetail {
  product: HydratedDocument<ProductDoc>;
  categoryName?: string;
}

export interface ProductServiceDeps {
  audit: AuditService;
  movement: MovementService;
  /** D-1: true only where the deployed tier has Atlas Search (staging/prod). */
  atlasSearch?: boolean;
}

export class ProductService {
  private readonly audit: AuditService;
  private readonly movement: MovementService;
  private readonly atlasSearch: boolean;

  constructor(deps: ProductServiceDeps) {
    this.audit = deps.audit;
    this.movement = deps.movement;
    this.atlasSearch = deps.atlasSearch ?? false;
  }

  /** GET /products — filters/search/sort per 05 §7.3. `archived` is applied by
   *  the caller-supplied value (Admin-gated in the controller, APD-02); omitted
   *  ⇒ active only. */
  async list(query: ProductsQuery): Promise<ProductListResult> {
    const filter: FilterQuery<ProductDoc> = { isArchived: query.archived ?? false };
    if (query.categoryId) filter.categoryId = new mongoose.Types.ObjectId(query.categoryId);

    if (query.stockStatus === 'out') filter.quantity = 0;
    else if (query.stockStatus === 'low')
      filter.$expr = {
        $and: [{ $gt: ['$quantity', 0] }, { $lte: ['$quantity', '$lowStockThreshold'] }],
      };
    else if (query.stockStatus === 'in')
      filter.$expr = { $gt: ['$quantity', '$lowStockThreshold'] };

    if (query.search) {
      // Fallback path (R-6): index-assisted where possible; SKU is stored
      // uppercase, name/barcode case-insensitive. Atlas $search would replace
      // this whole branch when `atlasSearch` is on (staging).
      const rx = new RegExp(escapeRegex(query.search), 'i');
      filter.$or = [{ name: rx }, { sku: rx }, { barcode: rx }];
    }

    const sortDir = query.order === 'asc' ? 1 : -1;
    const [data, totalItems] = await Promise.all([
      Product.find(filter)
        .sort({ [query.sort]: sortDir, _id: 1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit),
      Product.countDocuments(filter),
    ]);

    const categoryNames = await this.categoryNames(data.map((p) => p.categoryId));
    return { ...listEnvelope(data, query.page, query.limit, totalItems), categoryNames };
  }

  async getById(id: string): Promise<ProductDetail> {
    const product = await Product.findById(id);
    if (!product) throw new NotFoundError('Product not found.');
    const name = (await this.categoryNames([product.categoryId])).get(
      product.categoryId.toString(),
    );
    return { product, ...(name ? { categoryName: name } : {}) };
  }

  /** GET /products/lookup — barcode (primary) then SKU (fallback), BR-06.
   *  Archived products are RETURNED (reported as archived, BR-07), never 404.
   *  A malformed payload is a 422 INVALID_BARCODE (BR-16), not a 400. */
  async lookup(rawCode: string): Promise<HydratedDocument<ProductDoc>> {
    const code = rawCode.trim();
    if (!PRINTABLE_CODE.test(code)) throw new InvalidBarcodeError();

    const byBarcode = await Product.findOne({ barcode: code });
    const product = byBarcode ?? (await Product.findOne({ sku: code.toUpperCase() }));
    if (!product) throw new NotFoundError('No product matches that code.');
    return product;
  }

  /** POST /products (T2) — resolve category + threshold + SKU, then the atomic
   *  create-with-INITIAL via MovementService; map unique-index collisions. */
  async create(
    input: ProductCreateInput,
    actorId: Types.ObjectId | string,
    ctx: RequestContext = {},
  ): Promise<ProductDetail> {
    const category = await Category.findById(input.categoryId);
    if (!category) {
      throw new ValidationError([{ field: 'categoryId', message: 'Choose a valid category.' }]);
    }

    const lowStockThreshold = input.lowStockThreshold ?? (await this.defaultThreshold());
    const sku = input.sku ?? (await this.nextSku(category.name));

    try {
      const product = await this.movement.recordInitial({
        product: {
          name: input.name,
          sku,
          barcode: input.barcode,
          description: input.description,
          categoryId: category._id,
          costPrice: toDecimal(input.costPrice),
          sellingPrice: toDecimal(input.sellingPrice),
          lowStockThreshold,
          supplier: normalizeSupplier(input.supplier),
        },
        initialQuantity: input.initialQuantity,
        actorId,
        ctx,
      });
      return { product, categoryName: category.name };
    } catch (error) {
      throw await this.mapDuplicateKey(error);
    }
  }

  /** PATCH /products/:id (BR-24) — conditional update on `version`. SKU/quantity/
   *  isArchived are unreachable here (stripped by the schema). */
  async update(
    id: string,
    input: ProductUpdateInput,
    actorId: Types.ObjectId | string,
    ctx: RequestContext = {},
  ): Promise<ProductDetail> {
    const existing = await Product.findById(id);
    if (!existing) throw new NotFoundError('Product not found.');
    if (existing.version !== input.version) throw new StaleWriteError();

    if (input.categoryId !== undefined) {
      const exists = await Category.exists({ _id: input.categoryId });
      if (!exists)
        throw new ValidationError([{ field: 'categoryId', message: 'Choose a valid category.' }]);
    }

    const set: Record<string, unknown> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.barcode !== undefined) set.barcode = input.barcode;
    if (input.categoryId !== undefined)
      set.categoryId = new mongoose.Types.ObjectId(input.categoryId);
    if (input.description !== undefined) set.description = input.description;
    if (input.costPrice !== undefined) set.costPrice = toDecimal(input.costPrice);
    if (input.sellingPrice !== undefined) set.sellingPrice = toDecimal(input.sellingPrice);
    if (input.lowStockThreshold !== undefined) set.lowStockThreshold = input.lowStockThreshold;
    if (input.supplier !== undefined) set.supplier = normalizeSupplier(input.supplier);

    let updated: HydratedDocument<ProductDoc> | null;
    try {
      updated = await Product.findOneAndUpdate(
        { _id: id, version: input.version }, // BR-24 precondition — atomic
        { $set: set, $inc: { version: 1 } },
        { new: true },
      );
    } catch (error) {
      throw await this.mapDuplicateKey(error);
    }
    if (!updated) throw new StaleWriteError(); // lost the race between read and write

    const changes = this.diffUpdate(input, existing, updated);
    if (changes.length > 0) {
      await this.audit.record({
        actorId,
        entityType: 'PRODUCT',
        entityId: updated._id,
        action: 'UPDATE',
        entityLabel: `${updated.name} · ${updated.sku}`,
        changes,
        ip: ctx.ip,
      });
    }

    const name = (await this.categoryNames([updated.categoryId])).get(
      updated.categoryId.toString(),
    );
    return { product: updated, ...(name ? { categoryName: name } : {}) };
  }

  /** POST /products/:id/archive (T3) — quantity == 0 predicate inside the write
   *  (BR-22): a concurrent movement aborts one of the two operations. */
  async archive(
    id: string,
    actorId: Types.ObjectId | string,
    ctx: RequestContext = {},
  ): Promise<ProductDetail> {
    const existing = await Product.findById(id);
    if (!existing) throw new NotFoundError('Product not found.');
    if (existing.isArchived) throw new ProductArchivedError();

    const archived = await Product.findOneAndUpdate(
      { _id: id, isArchived: false, quantity: 0 }, // atomic BR-22 predicate
      { $set: { isArchived: true }, $inc: { version: 1 } },
      { new: true },
    );
    if (!archived) {
      const fresh = await Product.findById(id);
      if (fresh?.isArchived) throw new ProductArchivedError();
      throw new ProductNotEmptyError(); // quantity ≠ 0
    }

    await this.audit.record({
      actorId,
      entityType: 'PRODUCT',
      entityId: archived._id,
      action: 'ARCHIVE',
      entityLabel: `${archived.name} · ${archived.sku}`,
      changes: [{ field: 'isArchived', before: false, after: true }],
      ip: ctx.ip,
    });
    const name = (await this.categoryNames([archived.categoryId])).get(
      archived.categoryId.toString(),
    );
    return { product: archived, ...(name ? { categoryName: name } : {}) };
  }

  /** POST /products/:id/restore — lossless point update (FR-PROD-04). Restoring
   *  a non-archived product is an explicit 400, not a no-op. */
  async restore(
    id: string,
    actorId: Types.ObjectId | string,
    ctx: RequestContext = {},
  ): Promise<ProductDetail> {
    const existing = await Product.findById(id);
    if (!existing) throw new NotFoundError('Product not found.');
    if (!existing.isArchived) {
      throw new ValidationError([{ field: 'id', message: 'This product is not archived.' }]);
    }

    const restored = await Product.findOneAndUpdate(
      { _id: id, isArchived: true },
      { $set: { isArchived: false }, $inc: { version: 1 } },
      { new: true },
    );
    if (!restored)
      throw new ValidationError([{ field: 'id', message: 'This product is not archived.' }]);

    await this.audit.record({
      actorId,
      entityType: 'PRODUCT',
      entityId: restored._id,
      action: 'RESTORE',
      entityLabel: `${restored.name} · ${restored.sku}`,
      changes: [{ field: 'isArchived', before: true, after: false }],
      ip: ctx.ip,
    });
    const name = (await this.categoryNames([restored.categoryId])).get(
      restored.categoryId.toString(),
    );
    return { product: restored, ...(name ? { categoryName: name } : {}) };
  }

  /** DELETE /products/:id (T4) — assert zero ledger history + delete + audit,
   *  one atomic transaction (BR-23). Any product with an INITIAL row (non-zero
   *  opening stock) or any movement is history-bearing → PRODUCT_HAS_HISTORY. */
  async hardDelete(
    id: string,
    actorId: Types.ObjectId | string,
    ctx: RequestContext = {},
  ): Promise<void> {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(
        async () => {
          const product = await Product.findById(id).session(session);
          if (!product) throw new NotFoundError('Product not found.');

          const hasHistory = await Transaction.exists({ productId: product._id }).session(session);
          if (hasHistory) throw new ProductHasHistoryError();

          await product.deleteOne({ session });
          await this.audit.record(
            {
              actorId,
              entityType: 'PRODUCT',
              entityId: product._id,
              action: 'DELETE',
              entityLabel: `${product.name} · ${product.sku}`, // DN-4: survives the delete
              ip: ctx.ip,
            },
            { session },
          );
          // Cloudinary asset destroy (BR-38) is F5's pipeline (images are [] in F4).
        },
        { readConcern: { level: 'majority' }, writeConcern: { w: 'majority' } },
      );
    } finally {
      await session.endSession();
    }
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  /** BR-04 / PDV-02: `<PREFIX>-<seq padded to 5>`. Prefix = first 4 alphanumeric
   *  chars of the category name, uppercased ("Electronics" → "ELEC"). The exact
   *  derivation is a PDV — the docs give only `<CATEGORY-PREFIX>` + the ELEC
   *  example; this rule is deterministic and index-authoritative (a rare
   *  cross-category prefix clash just shares one sequence — SKUs stay unique). */
  private async nextSku(categoryName: string): Promise<string> {
    const prefix = deriveSkuPrefix(categoryName);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const counter = await mongoose.connection
          .collection('counters')
          .findOneAndUpdate(
            { _id: prefix as unknown as never },
            { $inc: { seq: 1 } },
            { upsert: true, returnDocument: 'after' },
          );
        const seq = (counter as { seq: number } | null)?.seq ?? 1;
        return `${prefix}-${String(seq).padStart(5, '0')}`;
      } catch (error) {
        // first-creation upsert race → duplicate _id; retry (the doc now exists)
        if ((error as { code?: number }).code === MONGO_DUPLICATE_KEY) continue;
        throw error;
      }
    }
    throw new Error(`SKU counter contention for prefix ${prefix}`);
  }

  private async defaultThreshold(): Promise<number> {
    const settings = await Settings.findOne().select('defaultLowStockThreshold');
    return settings?.defaultLowStockThreshold ?? DEFAULT_LOW_STOCK;
  }

  private async categoryNames(ids: Types.ObjectId[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const cats = await Category.find({ _id: { $in: ids } }).select('name');
    return new Map(cats.map((c) => [c._id.toString(), c.name]));
  }

  /** Diff only the fields the caller actually provided, using comparable scalar
   *  reps (Decimal128/ObjectId/supplier → strings) so `computeChanges` is exact. */
  private diffUpdate(
    input: ProductUpdateInput,
    before: HydratedDocument<ProductDoc>,
    after: HydratedDocument<ProductDoc>,
  ) {
    const fields: string[] = [];
    const b: Record<string, unknown> = {};
    const a: Record<string, unknown> = {};
    const track = (key: string, bv: unknown, av: unknown) => {
      fields.push(key);
      b[key] = bv;
      a[key] = av;
    };
    if (input.name !== undefined) track('name', before.name, after.name);
    if (input.barcode !== undefined) track('barcode', before.barcode, after.barcode);
    if (input.categoryId !== undefined)
      track('categoryId', before.categoryId.toString(), after.categoryId.toString());
    if (input.description !== undefined)
      track('description', before.description, after.description);
    if (input.costPrice !== undefined)
      track('costPrice', before.costPrice.toString(), after.costPrice.toString());
    if (input.sellingPrice !== undefined)
      track('sellingPrice', before.sellingPrice.toString(), after.sellingPrice.toString());
    if (input.lowStockThreshold !== undefined)
      track('lowStockThreshold', before.lowStockThreshold, after.lowStockThreshold);
    if (input.supplier !== undefined)
      track(
        'supplier',
        JSON.stringify(before.supplier ?? null),
        JSON.stringify(after.supplier ?? null),
      );
    return AuditService.computeChanges(b, a, fields);
  }

  /** 11000 → the right typed 409. Barcode collisions carry the conflicting
   *  product (name+SKU) in `details` (BR-05). */
  private async mapDuplicateKey(error: unknown): Promise<unknown> {
    const err = error as {
      code?: number;
      keyPattern?: Record<string, unknown>;
      keyValue?: Record<string, unknown>;
    };
    if (err.code !== MONGO_DUPLICATE_KEY) return error;
    if (err.keyPattern?.sku) return new DuplicateSkuError();
    if (err.keyPattern?.barcode) {
      const barcode = err.keyValue?.barcode;
      const conflict =
        typeof barcode === 'string' ? await Product.findOne({ barcode }).select('name sku') : null;
      return new DuplicateBarcodeError(
        conflict ? { name: conflict.name, sku: conflict.sku } : undefined,
      );
    }
    return error;
  }
}

/** ProductService-local: string decimal → Decimal128 (validated ≥ 0, ≤ 2dp). */
function toDecimal(value: string): mongoose.Types.Decimal128 {
  return mongoose.Types.Decimal128.fromString(value);
}

/** Drop absent optional keys so the value satisfies the model's exact-optional
 *  ProductSupplier (an explicit `undefined` is not an allowed member value). */
function normalizeSupplier(supplier: ProductCreateInput['supplier']): ProductDoc['supplier'] {
  if (!supplier) return undefined;
  return {
    name: supplier.name,
    ...(supplier.contactName !== undefined ? { contactName: supplier.contactName } : {}),
    ...(supplier.phone !== undefined ? { phone: supplier.phone } : {}),
    ...(supplier.email !== undefined ? { email: supplier.email } : {}),
  };
}

/** First ≤ 4 alphanumeric chars of the category name, uppercased; 'SKU' fallback. */
function deriveSkuPrefix(categoryName: string): string {
  const cleaned = categoryName.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return cleaned.slice(0, 4) || 'SKU';
}
