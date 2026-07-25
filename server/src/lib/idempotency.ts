/**
 * Movement idempotency helper — BEA §6 ("idempotency helper in `lib/` BEFORE the
 * service, so T1 stays readable and the pattern cannot be half-applied"); ARB-02.
 *
 * The whole replay contract lives here so MovementService.recordMovement reads as
 * "run T1 once", and every path — fast-path hit, concurrent duplicate-key race,
 * and payload-mismatch conflict — is decided in ONE place:
 *
 *   1. Fast path — a committed Transaction already carries this key:
 *        · identical payload  → return it as a REPLAY (committed work never re-runs, A-4)
 *        · different payload   → `IDEMPOTENCY_CONFLICT` (422, BR-20)
 *   2. No fast-path hit — run T1 (`execute`). If the insert loses a concurrent
 *      same-key race, the unique-sparse index throws duplicate-key; T1 aborts,
 *      we re-read the winner and apply the same replay/conflict decision (ARB-02).
 *      A duplicate key is therefore NEVER an error to the caller — it is the
 *      replay signal (docs/15 §3).
 *
 * "Same payload" is reconstructed from the STORED row (the ledger schema is a
 * closed set — no payload-hash field, PDV-01): every accepted movement is fully
 * determined by {productId, type, reason, note} plus either the signed
 * `quantityChange` (IN/OUT/delta) or, for a counted adjustment, the resulting
 * `quantityAfter` (which IS the counted value). So the stored Transaction alone
 * suffices to tell a genuine replay from a key-reuse bug.
 */
import type { HydratedDocument } from 'mongoose';

import { IdempotencyConflictError } from '../errors/AppError.js';
import {
  Transaction,
  type AdjustmentReason,
  type TransactionDoc,
  type TransactionType,
} from '../models/Transaction.js';

const MONGO_DUPLICATE_KEY = 11000;

/** The client's intent, normalized to compare against a stored ledger row. */
export type MovementReplayIntent = {
  productId: string; // 24-hex
  type: TransactionType;
  reason?: AdjustmentReason | undefined;
  note?: string | undefined;
} & ({ by: 'change'; quantityChange: number } | { by: 'counted'; countedQuantity: number });

/** True for a MongoDB duplicate-key error, optionally scoped to one indexed field. */
export function isDuplicateKeyError(error: unknown, field?: string): boolean {
  const err = error as { code?: number; keyPattern?: Record<string, unknown> } | null;
  if (!err || err.code !== MONGO_DUPLICATE_KEY) return false;
  return field === undefined || Boolean(err.keyPattern && field in err.keyPattern);
}

/** Does a committed Transaction represent the SAME submission as this intent? */
export function matchesStored(
  intent: MovementReplayIntent,
  txn: Pick<
    TransactionDoc,
    'productId' | 'type' | 'reason' | 'note' | 'quantityChange' | 'quantityAfter'
  >,
): boolean {
  if (txn.productId.toString() !== intent.productId) return false;
  if (txn.type !== intent.type) return false;
  if ((txn.reason ?? undefined) !== (intent.reason ?? undefined)) return false;
  if ((txn.note ?? undefined) !== (intent.note ?? undefined)) return false;
  return intent.by === 'change'
    ? txn.quantityChange === intent.quantityChange
    : txn.quantityAfter === intent.countedQuantity;
}

function replayOrConflict(
  intent: MovementReplayIntent,
  stored: HydratedDocument<TransactionDoc>,
): HydratedDocument<TransactionDoc> {
  if (matchesStored(intent, stored)) return stored;
  throw new IdempotencyConflictError();
}

export interface IdempotentMovementResult {
  transaction: HydratedDocument<TransactionDoc>;
  replayed: boolean;
}

/**
 * Run `execute` (the T1 boundary) under the replay contract. `execute` MUST
 * insert the Transaction with this `key`; its returned document is the freshly
 * committed row. Throws `IDEMPOTENCY_CONFLICT` on key reuse with a different
 * payload; every other movement error (`INSUFFICIENT_STOCK`, `PRODUCT_ARCHIVED`,
 * transient→503) propagates unchanged.
 */
export async function withMovementIdempotency(
  key: string,
  intent: MovementReplayIntent,
  execute: () => Promise<HydratedDocument<TransactionDoc>>,
): Promise<IdempotentMovementResult> {
  const existing = await Transaction.findOne({ idempotencyKey: key });
  if (existing) return { transaction: replayOrConflict(intent, existing), replayed: true };

  try {
    return { transaction: await execute(), replayed: false };
  } catch (error) {
    // ARB-02: the concurrent same-key loser sees the index's duplicate-key —
    // re-read the winner and replay, never surface the collision as an error.
    if (isDuplicateKeyError(error, 'idempotencyKey')) {
      const winner = await Transaction.findOne({ idempotencyKey: key });
      if (winner) return { transaction: replayOrConflict(intent, winner), replayed: true };
    }
    throw error;
  }
}
