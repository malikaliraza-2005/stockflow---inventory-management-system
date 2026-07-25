/**
 * Stock-movement schema — the client MIRROR of
 * server/src/validation/schemas/movements.ts (VAL §11; F6 dialogs). One rule
 * changed = both files change. The dialog converts its text inputs to numbers
 * (or undefined when blank) before `safeParse`, so the numeric primitives stay
 * mirror-exact (`z.number`, not coerced).
 *
 * `INITIAL` is server-only and excluded here; the `Idempotency-Key` header lives
 * in the api layer, not this body schema.
 */
import { z } from 'zod';

import { movementQty, noteText, objectId, quantityInt } from '../primitives';

/** Client-accepted movement types — `INITIAL` deliberately excluded. */
export const MOVEMENT_TYPES = ['STOCK_IN', 'STOCK_OUT', 'ADJUSTMENT'] as const;

/** Mirror of the server ADJUSTMENT_REASONS closed set (models/Transaction.ts). */
export const ADJUSTMENT_REASONS = [
  'DAMAGED',
  'LOST',
  'FOUND',
  'COUNT_CORRECTION',
  'RETURN',
  'OTHER',
] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export const movementMessages = {
  type: 'Invalid movement type',
  adjustmentAmount: 'Enter an adjustment amount',
  reason: 'Choose a reason',
  noteForOther: 'A note is required for Other',
} as const;

const note = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  noteText.optional(),
);

const delta = z
  .number(movementMessages.adjustmentAmount)
  .int(movementMessages.adjustmentAmount)
  .min(-100_000, movementMessages.adjustmentAmount)
  .max(100_000, movementMessages.adjustmentAmount)
  .refine((value) => value !== 0, movementMessages.adjustmentAmount);

const stockInOutSchema = z.object({
  type: z.enum(['STOCK_IN', 'STOCK_OUT']),
  productId: objectId,
  quantity: movementQty,
  note,
});

const adjustmentSchema = z
  .object({
    type: z.literal('ADJUSTMENT'),
    productId: objectId,
    delta: delta.optional(),
    countedQuantity: quantityInt.optional(),
    reason: z.enum(ADJUSTMENT_REASONS, { message: movementMessages.reason }),
    note,
  })
  .refine((body) => (body.delta === undefined) !== (body.countedQuantity === undefined), {
    message: movementMessages.adjustmentAmount,
    path: ['delta'],
  })
  .refine((body) => body.reason !== 'OTHER' || body.note !== undefined, {
    message: movementMessages.noteForOther,
    path: ['note'],
  });

export const movementSchema = z.discriminatedUnion('type', [stockInOutSchema, adjustmentSchema], {
  message: movementMessages.type,
});

export type MovementInput = z.infer<typeof movementSchema>;
export type StockInOutInput = z.infer<typeof stockInOutSchema>;
export type AdjustmentInput = z.infer<typeof adjustmentSchema>;
