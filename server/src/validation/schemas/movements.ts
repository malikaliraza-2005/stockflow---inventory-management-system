/**
 * Stock-movement endpoint schema — VAL §3.4 (F6 T-a); DBD §2.4. The request body
 * for `POST /inventory/movements`, the load-bearing ledger endpoint (ARC §3.2).
 *
 * A discriminated union on `type` — the two shapes the wire actually carries:
 *   STOCK_IN / STOCK_OUT → `{ productId, quantity, note? }`
 *   ADJUSTMENT           → `{ productId, delta XOR countedQuantity, reason, note? }`
 *
 * `INITIAL` is server-only (recordInitial, T2) and is NOT in the accepted enum —
 * a client that sends it gets "Invalid movement type", never a ledger row.
 *
 * Server-derived fields never appear here (VAL §3.4, BR-39): `userId`,
 * `createdAt`, `quantityChange`, `quantityAfter` are computed inside T1;
 * `refTransactionId` is reserved for system-originated compensations (R7) and is
 * likewise ignored from client input. The `Idempotency-Key` HEADER (BR-20) is
 * validated at the controller, not in this body schema.
 *
 * MIRROR: client/src/lib/validation/schemas/movements.ts — ships with the F6
 * dialogs task (StockMovementDialog / AdjustmentDialog).
 */
import { z } from 'zod';

import { ADJUSTMENT_REASONS } from '../../models/Transaction.js';
import { movementQty, noteText, objectId, quantityInt } from '../primitives.js';

/** Client-accepted movement types — `INITIAL` is deliberately excluded. */
export const MOVEMENT_TYPES = ['STOCK_IN', 'STOCK_OUT', 'ADJUSTMENT'] as const;

export const movementMessages = {
  type: 'Invalid movement type',
  adjustmentAmount: 'Enter an adjustment amount',
  reason: 'Choose a reason',
  noteForOther: 'A note is required for Other',
} as const;

/** Blank note → absent (never stored empty); then the ≤ 500 rule (BR-13 note). */
const note = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  noteText.optional(),
);

/** ADJUSTMENT delta — signed, ≠ 0, |delta| ≤ 100,000 (VAL §3.4). Direction is the
 *  sign here (the sole signed input, BR-12); IN/OUT derive direction from type. */
const delta = z
  .number(movementMessages.adjustmentAmount)
  .int(movementMessages.adjustmentAmount)
  .min(-100_000, movementMessages.adjustmentAmount)
  .max(100_000, movementMessages.adjustmentAmount)
  .refine((value) => value !== 0, movementMessages.adjustmentAmount);

/** STOCK_IN / STOCK_OUT — a positive movement quantity (1–100,000, BR-12). The
 *  OUT `≤ available` check is enforced at execution (T1 → INSUFFICIENT_STOCK),
 *  never here: the form-render value is not authoritative (BR-11). */
const stockInOutSchema = z.object({
  type: z.enum(['STOCK_IN', 'STOCK_OUT']),
  productId: objectId,
  quantity: movementQty,
  note,
});

/** ADJUSTMENT (Admin) — `delta` XOR `countedQuantity`; a reason is mandatory and
 *  `OTHER` additionally requires a note. Counted-absolute mode cannot produce a
 *  negative result by construction (BR-13) — the service computes the delta. */
const adjustmentSchema = z
  .object({
    type: z.literal('ADJUSTMENT'),
    productId: objectId,
    delta: delta.optional(),
    countedQuantity: quantityInt.optional(), // 0 allowed — count-to-zero
    reason: z.enum(ADJUSTMENT_REASONS, { message: movementMessages.reason }),
    note,
  })
  .refine(
    (body) => (body.delta === undefined) !== (body.countedQuantity === undefined),
    { message: movementMessages.adjustmentAmount, path: ['delta'] }, // exactly one
  )
  .refine((body) => body.reason !== 'OTHER' || body.note !== undefined, {
    message: movementMessages.noteForOther,
    path: ['note'],
  });

/** POST /inventory/movements body (§7.5). Discriminated on `type`; an unknown or
 *  `INITIAL` type fails at the discriminator with `movementMessages.type`. */
export const movementSchema = z.discriminatedUnion('type', [stockInOutSchema, adjustmentSchema], {
  message: movementMessages.type,
});

export type MovementInput = z.infer<typeof movementSchema>;
export type StockInOutInput = z.infer<typeof stockInOutSchema>;
export type AdjustmentInput = z.infer<typeof adjustmentSchema>;
