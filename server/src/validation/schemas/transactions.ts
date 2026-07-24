/**
 * Ledger query schema — VAL §5 "Transactions" (F7 T-a); the GET /transactions
 * filter set (05 §7.6). Read-only: the ledger is append-only, so there is no
 * write schema here.
 *
 * Filters mirror the WIR §11 ledger tab: date range · type · product · user ·
 * include-archived. `includeArchived` defaults false — archived-product rows are
 * hidden until asked for (they still render with an archived badge, EC-16).
 *
 * MIRROR: client/src/lib/validation/schemas/transactions.ts — ships with the F7
 * ledger tab task.
 */
import { z } from 'zod';

import { TRANSACTION_TYPES } from '../../models/Transaction.js';
import { isoDate, objectId } from '../primitives.js';

export const transactionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20), // NFR-10
  from: isoDate.optional(),
  to: isoDate.optional(),
  type: z.enum(TRANSACTION_TYPES).optional(),
  productId: objectId.optional(),
  userId: objectId.optional(),
  includeArchived: z
    .preprocess((value) => {
      if (value === 'true') return true;
      if (value === 'false') return false;
      return value;
    }, z.boolean())
    .default(false),
});

export type TransactionsQuery = z.infer<typeof transactionsQuerySchema>;
