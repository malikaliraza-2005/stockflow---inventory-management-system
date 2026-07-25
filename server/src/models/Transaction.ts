/**
 * `transactions` — DBD §2.4, the append-only stock ledger. ∎ DES-1:
 *
 *  - NO update/delete code path may exist (insert-only); NO `updatedAt` (the
 *    JSON-schema validator would reject it — that validator lands with F6, the
 *    idempotent movement path; F4's Mongoose schema is the first layer).
 *  - Collectively the source of truth for `product.quantity` (BR-17, DN-1):
 *    `quantity == Σ quantityChange`.
 *
 * F4 scope (recordInitial): this model is written ONLY with `type: 'INITIAL'`
 * rows — one per newly created product carrying non-zero initial stock. The
 * `type` enum and reason enum are the FULL closed sets (PDV-01) so F6 extends
 * *usage* (STOCK_IN/OUT/ADJUSTMENT + idempotency), never the catalog. The
 * `{idempotencyKey}` sparse-unique index and the movement machinery are F6's.
 *
 * INITIAL rows carry NO `idempotencyKey` (PDV-04 — unset, never '') and NO
 * `reason`/`note`/`refTransactionId`.
 */
import { model, Schema, type Types } from 'mongoose';

/** Closed set (PDV-01). INITIAL is system-only — never accepted from clients. */
export const TRANSACTION_TYPES = ['INITIAL', 'STOCK_IN', 'STOCK_OUT', 'ADJUSTMENT'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

/** BR-13 — required iff `type === 'ADJUSTMENT'` (enforced in F6's movement path). */
export const ADJUSTMENT_REASONS = [
  'DAMAGED',
  'LOST',
  'FOUND',
  'COUNT_CORRECTION',
  'RETURN',
  'OTHER',
] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export interface TransactionDoc {
  productId: Types.ObjectId;
  type: TransactionType;
  quantityChange: number; // signed, ≠ 0 (BR-12)
  quantityAfter: number; // ≥ 0 snapshot (DN-2, BR-40)
  userId: Types.ObjectId; // server-derived actor (BR-39)
  reason?: AdjustmentReason;
  note?: string;
  refTransactionId?: Types.ObjectId;
  idempotencyKey?: string; // sparse unique (F6) — unset on INITIAL (PDV-04)
  createdAt: Date;
}

const transactionSchema = new Schema<TransactionDoc>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    type: { type: String, required: true, enum: TRANSACTION_TYPES },
    quantityChange: { type: Number, required: true },
    quantityAfter: { type: Number, required: true, min: 0 },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, enum: ADJUSTMENT_REASONS },
    note: { type: String, maxlength: 500 },
    refTransactionId: { type: Schema.Types.ObjectId, ref: 'Transaction' },
    idempotencyKey: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }, // DES-1: no updatedAt
);

// DBD §2.4 index set.
transactionSchema.index({ productId: 1, createdAt: -1 }); // history, reconciliation
transactionSchema.index({ createdAt: -1 }); // ledger list, dashboard, reports
transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ type: 1, createdAt: -1 });
// F6: the authoritative movement dedup (BR-20, ARB-02). SPARSE so INITIAL /
// compensation rows (which carry no key, PDV-04) never collide; UNIQUE so a
// duplicate client key is a hard duplicate-key error the movement transaction
// catches and re-reads as a replay. Sparse+unique = "unique among documents
// that HAVE the field" — exactly the movement-replay semantics.
transactionSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

export const Transaction = model<TransactionDoc>('Transaction', transactionSchema);
