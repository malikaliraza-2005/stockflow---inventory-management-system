/**
 * TransactionService — the READ side of the ledger (F7 P3 slice, FR-TXN-01…03).
 * The append-only `transactions` collection has no service write path here
 * (DES-1); MovementService is the sole writer. This service only lists rows for
 * the Stock Ledger tab, resolving each row's product + user display labels.
 *
 * `includeArchived=false` (default) hides rows whose product is archived — UNLESS
 * the caller explicitly filtered to one `productId` (explicit intent wins). When
 * shown, archived-product rows carry an archived flag for the EC-16 badge.
 *
 * Plans ride the DBD §2.4 indexes: `{createdAt:-1}` for the default list,
 * `{productId,createdAt:-1}` / `{userId,createdAt:-1}` / `{type,createdAt:-1}`
 * for the filtered forms.
 */
import { Types, type FilterQuery } from 'mongoose';

import { listEnvelope, type ListEnvelope } from '../lib/pagination.js';
import { Product } from '../models/Product.js';
import { Transaction, type TransactionDoc } from '../models/Transaction.js';
import { User } from '../models/User.js';
import type { TransactionsQuery } from '../validation/schemas/transactions.js';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** A lean ledger row — the `.lean()` shape the serializer consumes. */
export type LedgerRow = TransactionDoc & { _id: Types.ObjectId };

export interface LedgerProductLabel {
  name: string;
  sku: string;
  isArchived: boolean;
}
export interface LedgerUserLabel {
  name: string;
}

export interface TransactionListResult extends ListEnvelope<LedgerRow> {
  products: Map<string, LedgerProductLabel>;
  users: Map<string, LedgerUserLabel>;
}

export class TransactionService {
  async list(query: TransactionsQuery): Promise<TransactionListResult> {
    const filter = await this.buildFilter(query);

    const skip = (query.page - 1) * query.limit;
    const [rows, totalItems] = await Promise.all([
      Transaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit).lean(),
      Transaction.countDocuments(filter),
    ]);

    const products = await this.resolveProducts(rows);
    const users = await this.resolveUsers(rows);

    return {
      ...listEnvelope(rows as unknown as LedgerRow[], query.page, query.limit, totalItems),
      products,
      users,
    };
  }

  private async buildFilter(query: TransactionsQuery): Promise<FilterQuery<TransactionDoc>> {
    const filter: FilterQuery<TransactionDoc> = {};

    if (query.from || query.to) {
      const createdAt: Record<string, Date> = {};
      if (query.from) createdAt.$gte = new Date(query.from);
      if (query.to) createdAt.$lte = endOfRange(query.to);
      filter.createdAt = createdAt;
    }
    if (query.type) filter.type = query.type;
    if (query.userId) filter.userId = new Types.ObjectId(query.userId);

    if (query.productId) {
      // Explicit product filter wins over the archived-hide rule.
      filter.productId = new Types.ObjectId(query.productId);
    } else if (!query.includeArchived) {
      const archived = await Product.find({ isArchived: true }).select('_id').lean();
      if (archived.length > 0) {
        filter.productId = { $nin: archived.map((p) => p._id) };
      }
    }

    return filter;
  }

  private async resolveProducts(
    rows: Pick<TransactionDoc, 'productId'>[],
  ): Promise<Map<string, LedgerProductLabel>> {
    const ids = [...new Set(rows.map((r) => r.productId.toString()))];
    const products = await Product.find({ _id: { $in: ids } })
      .select('name sku isArchived')
      .lean();
    return new Map(
      products.map((p) => [
        p._id.toString(),
        { name: p.name, sku: p.sku, isArchived: p.isArchived },
      ]),
    );
  }

  private async resolveUsers(
    rows: Pick<TransactionDoc, 'userId'>[],
  ): Promise<Map<string, LedgerUserLabel>> {
    const ids = [...new Set(rows.map((r) => r.userId.toString()))];
    const users = await User.find({ _id: { $in: ids } })
      .select('name')
      .lean();
    return new Map(users.map((u) => [u._id.toString(), { name: u.name }]));
  }
}

/** Inclusive end of a date range — a date-only `to` covers its whole UTC day. */
function endOfRange(to: string): Date {
  return DATE_ONLY.test(to) ? new Date(`${to}T23:59:59.999Z`) : new Date(to);
}
