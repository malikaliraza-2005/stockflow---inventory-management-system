/**
 * MovementService — the SOLE writer of `product.quantity` and the ONLY producer
 * of `transactions` rows (DN-1, BR-17). Change-controlled: every diff to this
 * file requires the architecture-review label (IMP-020 §5, from F4 onward).
 *
 * ── F4 slice: `recordInitial` (T2) — IMP-020 review Issue 1 ────────────────
 * The FIRST slice of MovementService. When a product is created, this runs the
 * T2 boundary (DBD §4) as ONE majority multi-document transaction:
 *
 *     insert product (quantity := initialQuantity)
 *     ├─ if initialQuantity ≠ 0: insert an INITIAL ledger row
 *     │    (quantityChange = quantityAfter = initialQuantity, no idempotencyKey)
 *     └─ insert the CREATE audit entry
 *
 * The invariant `quantity == Σ ledger` therefore holds from the very first
 * product — no back-filling of an append-only ledger is ever required (which
 * would falsify timestamps). No conditional stock guard is needed here: the
 * product is brand new, so there is no `quantity ≥ requested` predicate — that
 * (T1, the movement path) is F6's extension of this same module.
 *
 * BR-17: only NON-ZERO initial stock produces an INITIAL row (a zero-quantity
 * product has an empty-but-consistent ledger — Σ = quantity = 0).
 *
 * The SKU counter increment lives OUTSIDE this transaction (ProductService) —
 * the same reason UserService keeps its guard upsert out of T6: a first-run
 * upsert inside a transaction surfaces as a NON-transient duplicate-key instead
 * of a retryable write conflict.
 */
import mongoose, { type HydratedDocument, type Types } from 'mongoose';

import { ValidationError } from '../errors/AppError.js';
import { Category } from '../models/Category.js';
import { Product, type ProductDoc } from '../models/Product.js';
import { Transaction } from '../models/Transaction.js';
import { AuditService } from './AuditService.js';
import type { RequestContext } from './AuthService.js';

/** The product fields recordInitial persists — `quantity` is set from
 * `initialQuantity` here, never accepted from the caller's catalog payload. */
export interface NewProductData {
  name: string;
  sku: string;
  barcode?: string | undefined;
  description?: string | undefined;
  categoryId: Types.ObjectId;
  costPrice: Types.Decimal128;
  sellingPrice: Types.Decimal128;
  lowStockThreshold: number;
  supplier?: ProductDoc['supplier'];
  images?: ProductDoc['images'];
}

export interface RecordInitialParams {
  product: NewProductData;
  initialQuantity: number;
  actorId: Types.ObjectId | string;
  ctx?: RequestContext;
}

export interface MovementServiceDeps {
  audit: AuditService;
}

export class MovementService {
  private readonly audit: AuditService;

  constructor(deps: MovementServiceDeps) {
    this.audit = deps.audit;
  }

  /** T2 — atomic product create + INITIAL ledger row + audit. Returns the
   *  persisted product. Duplicate-key errors (sku/barcode) propagate for the
   *  caller to map (ProductService owns the DUPLICATE_SKU/BARCODE translation). */
  async recordInitial(params: RecordInitialParams): Promise<HydratedDocument<ProductDoc>> {
    const { product, initialQuantity, actorId, ctx } = params;
    const session = await mongoose.startSession();
    try {
      let created!: HydratedDocument<ProductDoc>;
      await session.withTransaction(
        async () => {
          // BR-27 / DBD §2.3: category existence validated IN-transaction (where
          // racy) — if the category was deleted after ProductService read it, the
          // create aborts here rather than orphaning a reference.
          const categoryExists = await Category.exists({ _id: product.categoryId }).session(
            session,
          );
          if (!categoryExists) {
            throw new ValidationError([
              { field: 'categoryId', message: 'Choose a valid category.' },
            ]);
          }

          // insert product — quantity is the ledger's opening balance
          const [doc] = await Product.create(
            [
              {
                ...product,
                quantity: initialQuantity,
                images: product.images ?? [],
                isArchived: false,
                version: 0,
              },
            ],
            { session },
          );
          if (!doc) throw new Error('product insert returned no document');
          created = doc;

          // BR-17: a non-zero opening balance is one INITIAL ledger row
          if (initialQuantity !== 0) {
            await Transaction.create(
              [
                {
                  productId: doc._id,
                  type: 'INITIAL',
                  quantityChange: initialQuantity,
                  quantityAfter: initialQuantity,
                  userId: actorId,
                  // no idempotencyKey / reason / note / refTransactionId (PDV-04)
                },
              ],
              { session },
            );
          }

          await this.audit.record(
            {
              actorId,
              entityType: 'PRODUCT',
              entityId: doc._id,
              action: 'CREATE',
              entityLabel: `${doc.name} · ${doc.sku}`, // DN-4/ERB-01: name + SKU
              changes: [
                { field: 'sku', after: doc.sku },
                { field: 'quantity', after: initialQuantity },
              ],
              ip: ctx?.ip,
            },
            { session },
          );
        },
        {
          readConcern: { level: 'majority' },
          writeConcern: { w: 'majority' }, // A-1 (ratified)
        },
      );
      return created;
    } finally {
      await session.endSession();
    }
  }
}
