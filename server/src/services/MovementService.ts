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
import mongoose, { type FilterQuery, type HydratedDocument, type Types } from 'mongoose';

import {
  InsufficientStockError,
  NotFoundError,
  ProductArchivedError,
  ValidationError,
} from '../errors/AppError.js';
import { withMovementIdempotency, type MovementReplayIntent } from '../lib/idempotency.js';
import { Category } from '../models/Category.js';
import { Product, type ProductDoc } from '../models/Product.js';
import { Transaction, type TransactionDoc } from '../models/Transaction.js';
import type { MovementInput } from '../validation/schemas/movements.js';
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

export interface RecordMovementParams {
  /** RFC-4122 idempotency key (BR-20) — validated at the controller. */
  idempotencyKey: string;
  input: MovementInput;
  actorId: Types.ObjectId | string;
  ctx?: RequestContext;
}

export interface MovementResult {
  transaction: HydratedDocument<TransactionDoc>;
  /** The product AFTER the movement (current on a fresh write; re-read on replay). */
  product: HydratedDocument<ProductDoc>;
  /** true when this call replayed a previously committed movement (ARB-02). */
  replayed: boolean;
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

  /**
   * T1 — the movement path (F6). One atomic movement under the ARB-02 replay
   * contract: the idempotency helper decides fast-path replay / conflict / fresh
   * execution; `executeT1` is the single-attempt boundary it runs. Returns the
   * committed (or replayed) Transaction plus the resulting product state.
   *
   * Movements are NOT audited into `auditLogs` — the ledger row IS the record of
   * a stock change (auditLogs covers non-stock state, DBD §2.6).
   */
  async recordMovement(params: RecordMovementParams): Promise<MovementResult> {
    const { idempotencyKey, input, actorId } = params;

    const { transaction, replayed } = await withMovementIdempotency(
      idempotencyKey,
      toReplayIntent(input),
      () => this.executeT1(input, idempotencyKey, actorId),
    );

    // On a fresh write the product already reflects the change; on a replay we
    // re-read it so the caller can render lowStockThreshold/id. `quantityAfter`
    // on the transaction remains the authoritative resulting quantity (BR-11).
    const product = await Product.findById(transaction.productId);
    if (!product) throw new NotFoundError('Product not found.');
    return { transaction, product, replayed };
  }

  /**
   * A single T1 attempt (DBD §4): conditional `findOneAndUpdate` on the product
   * (`isArchived:false`; `quantity ≥ requested` for negatives) + Transaction
   * insert, one majority multi-document transaction. `withTransaction` retries
   * bounded transient conflicts (TransientTransactionError / unknown-commit
   * labels, NFR-18); a duplicate `idempotencyKey` is NON-transient, so it aborts
   * and surfaces to the idempotency helper as the replay signal (ARB-02).
   */
  private async executeT1(
    input: MovementInput,
    idempotencyKey: string,
    actorId: Types.ObjectId | string,
  ): Promise<HydratedDocument<TransactionDoc>> {
    const productId = new mongoose.Types.ObjectId(input.productId);
    const session = await mongoose.startSession();
    try {
      let created!: HydratedDocument<TransactionDoc>;
      await session.withTransaction(
        async () => {
          let quantityChange: number;
          let quantityAfter: number;

          if (input.type === 'ADJUSTMENT' && input.countedQuantity !== undefined) {
            // Counted-absolute mode — read the current quantity to derive the
            // delta, then a guard on that exact value makes the SET atomic (a
            // concurrent commit conflicts → withTransaction retries with a fresh
            // read). Cannot go negative by construction (BR-13).
            const current = await Product.findById(productId).session(session);
            if (!current) throw new NotFoundError('Product not found.');
            if (current.isArchived) throw new ProductArchivedError();
            quantityChange = input.countedQuantity - current.quantity;
            if (quantityChange === 0) {
              throw new ValidationError([
                {
                  field: 'countedQuantity',
                  message: 'Counted quantity matches current stock — no adjustment needed.',
                },
              ]);
            }
            const set = await Product.findOneAndUpdate(
              { _id: productId, isArchived: false, quantity: current.quantity },
              { $set: { quantity: input.countedQuantity } },
              { new: true, session },
            );
            if (!set) throw new Error('counted adjustment lost its conditional update');
            quantityAfter = set.quantity;
          } else {
            // IN / OUT / signed delta — one atomic conditional `$inc`; the
            // `quantity ≥ requested` predicate IS the stock guard (BR-11), no
            // read-then-write window.
            quantityChange = signedChange(input);
            const filter: FilterQuery<ProductDoc> = { _id: productId, isArchived: false };
            if (quantityChange < 0) filter.quantity = { $gte: -quantityChange };
            const updated = await Product.findOneAndUpdate(
              filter,
              { $inc: { quantity: quantityChange } },
              { new: true, session },
            );
            if (!updated) {
              // The predicate failed — re-read to classify precisely.
              const current = await Product.findById(productId).session(session);
              if (!current) throw new NotFoundError('Product not found.');
              if (current.isArchived) throw new ProductArchivedError();
              throw new InsufficientStockError(current.quantity, -quantityChange);
            }
            quantityAfter = updated.quantity;
          }

          const [txn] = await Transaction.create(
            [
              {
                productId,
                type: input.type,
                quantityChange,
                quantityAfter,
                userId: actorId,
                ...(input.type === 'ADJUSTMENT' ? { reason: input.reason } : {}),
                ...(input.note !== undefined ? { note: input.note } : {}),
                idempotencyKey,
              },
            ],
            { session },
          );
          if (!txn) throw new Error('transaction insert returned no document');
          created = txn;
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

/** IN → +qty · OUT → −qty · signed delta → itself. Counted mode is handled
 *  separately (its change is derived from the read quantity). */
function signedChange(input: MovementInput): number {
  // ADJUSTMENT via delta — the discriminated union guarantees delta is present
  // whenever countedQuantity is not (schema XOR refinement).
  if (input.type === 'ADJUSTMENT') return input.delta as number;
  return input.type === 'STOCK_IN' ? input.quantity : -input.quantity;
}

/** Normalize a request into the replay-comparison intent (ARB-02). */
function toReplayIntent(input: MovementInput): MovementReplayIntent {
  const base = { productId: input.productId, note: input.note };
  if (input.type === 'ADJUSTMENT') {
    return input.countedQuantity !== undefined
      ? {
          ...base,
          type: 'ADJUSTMENT',
          reason: input.reason,
          by: 'counted',
          countedQuantity: input.countedQuantity,
        }
      : {
          ...base,
          type: 'ADJUSTMENT',
          reason: input.reason,
          by: 'change',
          quantityChange: input.delta as number,
        };
  }
  return { ...base, type: input.type, by: 'change', quantityChange: signedChange(input) };
}
