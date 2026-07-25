/**
 * Ledger row serialization — the wire contract for GET /transactions (05 §7.6,
 * F7 ledger tab). Each row joins its captured product + user labels; a missing
 * reference (should not occur — products with history are never hard-deleted)
 * degrades to a placeholder rather than failing the list.
 *
 * `productArchived` drives the EC-16 archived badge in the ledger UI. Dates are
 * ISO-8601 UTC; optional `reason`/`note` are absent (never null) when unset.
 */
import type {
  LedgerProductLabel,
  LedgerRow,
  LedgerUserLabel,
} from '../services/TransactionService.js';

export interface TransactionRowPayload {
  id: string;
  createdAt: string;
  productId: string;
  productName: string;
  productSku: string;
  productArchived: boolean;
  type: string;
  quantityChange: number;
  quantityAfter: number;
  userId: string;
  userName: string;
  reason?: string;
  note?: string;
}

export function serializeTransactionRow(
  row: LedgerRow,
  labels: { product?: LedgerProductLabel | undefined; user?: LedgerUserLabel | undefined },
): TransactionRowPayload {
  return {
    id: row._id.toString(),
    createdAt: row.createdAt.toISOString(),
    productId: row.productId.toString(),
    productName: labels.product?.name ?? 'Unknown product',
    productSku: labels.product?.sku ?? '',
    productArchived: labels.product?.isArchived ?? false,
    type: row.type,
    quantityChange: row.quantityChange,
    quantityAfter: row.quantityAfter,
    userId: row.userId.toString(),
    userName: labels.user?.name ?? 'Unknown user',
    ...(row.reason ? { reason: row.reason } : {}),
    ...(row.note ? { note: row.note } : {}),
  };
}
