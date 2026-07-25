/**
 * Movement serialization — the wire contract for `POST /inventory/movements`
 * (05 §7.5). Built field-by-field: `_id` → `id` strings, dates ISO-8601 UTC,
 * optional `reason`/`note` absent (never null) when unset.
 *
 * The `product` slice reports `quantityAfter` from the Transaction as the
 * resulting `quantity` — on a fresh write it equals the product's current
 * quantity, and on a REPLAY it is the original outcome (A-4), so the response is
 * byte-identical to the first call regardless of later movements. `stockStatus`
 * is derived from that same snapshot (BR-11 server-authoritative).
 */
import type { MovementResult } from '../services/MovementService.js';
import { deriveStockStatus, type StockStatus } from './product.js';

export interface MovementTransactionPayload {
  id: string;
  productId: string;
  type: string;
  quantityChange: number;
  quantityAfter: number;
  userId: string;
  reason?: string;
  note?: string;
  createdAt: string;
}

export interface MovementProductPayload {
  id: string;
  quantity: number;
  lowStockThreshold: number;
  stockStatus: StockStatus;
}

export interface MovementPayload {
  transaction: MovementTransactionPayload;
  product: MovementProductPayload;
}

export function serializeMovement(result: MovementResult): MovementPayload {
  const { transaction, product } = result;
  return {
    transaction: {
      id: transaction._id.toString(),
      productId: transaction.productId.toString(),
      type: transaction.type,
      quantityChange: transaction.quantityChange,
      quantityAfter: transaction.quantityAfter,
      userId: transaction.userId.toString(),
      ...(transaction.reason ? { reason: transaction.reason } : {}),
      ...(transaction.note ? { note: transaction.note } : {}),
      createdAt: transaction.createdAt.toISOString(),
    },
    product: {
      id: product._id.toString(),
      quantity: transaction.quantityAfter, // authoritative resulting quantity (replay-faithful)
      lowStockThreshold: product.lowStockThreshold,
      stockStatus: deriveStockStatus(transaction.quantityAfter, product.lowStockThreshold),
    },
  };
}
