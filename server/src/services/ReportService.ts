/**
 * ReportService — the READ side of the five reports (F10, FR-RPT-01…05). Two
 * shapes per report: a paginated method (the on-screen table, 05 §5 envelope +
 * an optional totals row) and an async-generator `stream*` (the full filtered
 * dataset for CSV export — no pagination, cursor-backed so it never materializes
 * in memory).
 *
 * Historical reports (transactions, product-performance) derive EXCLUSIVELY from
 * the append-only ledger (BR-40) — re-running a past period is byte-identical.
 * Snapshot reports (inventory, low-stock, consistency) read current catalog
 * state and value stock at CURRENT cost (AS-17), stated in the UI footnote.
 * READ-ONLY throughout — no write path (like TransactionService/DashboardService).
 */
import { Types, type FilterQuery } from 'mongoose';

import { listEnvelope, type ListEnvelope } from '../lib/pagination.js';
import { Category } from '../models/Category.js';
import { Product, type ProductDoc } from '../models/Product.js';
import { Transaction, type TransactionDoc } from '../models/Transaction.js';
import { User } from '../models/User.js';
import {
  serializeInventoryRow,
  serializeLowStockRow,
  type ConsistencyRow,
  type InventoryProductLean,
  type InventoryReportRow,
  type InventoryTotals,
  type LowStockReportRow,
  type PerformanceTotals,
  type ProductPerformanceRow,
} from '../serializers/report.js';
import { serializeTransactionRow, type TransactionRowPayload } from '../serializers/transaction.js';
import type {
  ReportConsistencyQuery,
  ReportInventoryQuery,
  ReportLowStockQuery,
  ReportPerformanceQuery,
  ReportTransactionsQuery,
} from '../validation/schemas/reports.js';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const INVENTORY_FIELDS = 'sku name categoryId costPrice quantity lowStockThreshold';

/** A paginated report response — the §5 envelope plus an optional totals row. */
export type ReportResult<Row, Totals = undefined> = ListEnvelope<Row> &
  (Totals extends undefined ? { totals?: undefined } : { totals: Totals });

interface PerfGroup {
  _id: Types.ObjectId;
  in: number;
  out: number;
  net: number;
}

export class ReportService {
  // ── Inventory Summary (FR-RPT-01) ─────────────────────────────────────────

  async inventory(
    query: ReportInventoryQuery,
  ): Promise<ListEnvelope<InventoryReportRow> & { totals: InventoryTotals }> {
    const filter = inventoryFilter(query);
    const skip = (query.page - 1) * query.limit;

    const [rows, totalItems, totalsAgg, categories] = await Promise.all([
      Product.find(filter)
        .sort({ sku: 1 })
        .skip(skip)
        .limit(query.limit)
        .select(INVENTORY_FIELDS)
        .lean(),
      Product.countDocuments(filter),
      Product.aggregate<{ totalQuantity: number; totalValue: Types.Decimal128 }>([
        { $match: filter },
        {
          $group: {
            _id: null,
            totalQuantity: { $sum: '$quantity' },
            totalValue: { $sum: { $multiply: ['$costPrice', '$quantity'] } },
          },
        },
      ]),
      loadCategoryMap(),
    ]);

    const totals: InventoryTotals = {
      totalQuantity: totalsAgg[0]?.totalQuantity ?? 0,
      totalValue: totalsAgg[0]?.totalValue
        ? Number(totalsAgg[0].totalValue.toString()).toFixed(2)
        : '0.00',
    };
    return {
      ...listEnvelope(
        (rows as InventoryProductLean[]).map((p) =>
          serializeInventoryRow(p, categories.get(p.categoryId.toString()) ?? 'Uncategorized'),
        ),
        query.page,
        query.limit,
        totalItems,
      ),
      totals,
    };
  }

  async *streamInventory(query: ReportInventoryQuery): AsyncGenerator<InventoryReportRow> {
    const filter = inventoryFilter(query);
    const categories = await loadCategoryMap();
    const cursor = Product.find(filter).sort({ sku: 1 }).select(INVENTORY_FIELDS).lean().cursor();
    for await (const product of cursor) {
      const p = product as unknown as InventoryProductLean;
      yield serializeInventoryRow(p, categories.get(p.categoryId.toString()) ?? 'Uncategorized');
    }
  }

  // ── Low Stock (FR-RPT-02) ─────────────────────────────────────────────────

  async lowStock(query: ReportLowStockQuery): Promise<ListEnvelope<LowStockReportRow>> {
    const filter = lowStockFilter();
    const skip = (query.page - 1) * query.limit;

    const [rows, totalItems, categories] = await Promise.all([
      Product.find(filter)
        .sort({ quantity: 1 })
        .skip(skip)
        .limit(query.limit)
        .select(INVENTORY_FIELDS)
        .lean(),
      Product.countDocuments(filter),
      loadCategoryMap(),
    ]);

    return listEnvelope(
      (rows as InventoryProductLean[]).map((p) =>
        serializeLowStockRow(p, categories.get(p.categoryId.toString()) ?? 'Uncategorized'),
      ),
      query.page,
      query.limit,
      totalItems,
    );
  }

  async *streamLowStock(): AsyncGenerator<LowStockReportRow> {
    const categories = await loadCategoryMap();
    const cursor = Product.find(lowStockFilter())
      .sort({ quantity: 1 })
      .select(INVENTORY_FIELDS)
      .lean()
      .cursor();
    for await (const product of cursor) {
      const p = product as unknown as InventoryProductLean;
      yield serializeLowStockRow(p, categories.get(p.categoryId.toString()) ?? 'Uncategorized');
    }
  }

  // ── Transaction History (FR-RPT-03) — ledger-derived, byte-reproducible ────

  async transactions(query: ReportTransactionsQuery): Promise<ListEnvelope<TransactionRowPayload>> {
    const filter = transactionsFilter(query);
    const skip = (query.page - 1) * query.limit;

    const [rows, totalItems] = await Promise.all([
      Transaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit).lean(),
      Transaction.countDocuments(filter),
    ]);
    const labels = await resolveTransactionLabels(rows);

    return listEnvelope(
      (rows as LedgerLean[]).map((row) => serializeLabeledRow(row, labels)),
      query.page,
      query.limit,
      totalItems,
    );
  }

  async *streamTransactions(query: ReportTransactionsQuery): AsyncGenerator<TransactionRowPayload> {
    const labels = await loadAllLabels();
    const cursor = Transaction.find(transactionsFilter(query))
      .sort({ createdAt: -1 })
      .lean()
      .cursor();
    for await (const row of cursor) {
      yield serializeLabeledRow(row as LedgerLean, labels);
    }
  }

  // ── Product Performance (FR-RPT-04) — ledger in/out/net over a range ───────

  async performance(
    query: ReportPerformanceQuery,
  ): Promise<ListEnvelope<ProductPerformanceRow> & { totals: PerformanceTotals }> {
    const match = { createdAt: dateRange(query.from, query.to) };
    const skip = (query.page - 1) * query.limit;

    const [groups, countAgg, totalsAgg] = await Promise.all([
      Transaction.aggregate<PerfGroup>([
        { $match: match },
        { $group: { _id: '$productId', ...inOutAccumulators() } },
        { $addFields: { net: { $subtract: ['$in', '$out'] } } },
        { $sort: { net: -1, _id: 1 } },
        { $skip: skip },
        { $limit: query.limit },
      ]),
      Transaction.aggregate<{ n: number }>([
        { $match: match },
        { $group: { _id: '$productId' } },
        { $count: 'n' },
      ]),
      Transaction.aggregate<PerformanceTotals & { _id: null }>([
        { $match: match },
        { $group: { _id: null, ...inOutAccumulators() } },
        {
          $project: { totalIn: '$in', totalOut: '$out', totalNet: { $subtract: ['$in', '$out'] } },
        },
      ]),
    ]);

    const labels = await resolveProductLabels(groups.map((g) => g._id));
    const totalItems = countAgg[0]?.n ?? 0;
    const totals: PerformanceTotals = {
      totalIn: totalsAgg[0]?.totalIn ?? 0,
      totalOut: totalsAgg[0]?.totalOut ?? 0,
      totalNet: totalsAgg[0]?.totalNet ?? 0,
    };
    return {
      ...listEnvelope(
        groups.map((g) => performanceRow(g, labels)),
        query.page,
        query.limit,
        totalItems,
      ),
      totals,
    };
  }

  async *streamPerformance(query: ReportPerformanceQuery): AsyncGenerator<ProductPerformanceRow> {
    const labels = await loadAllProductLabels();
    const cursor = Transaction.aggregate<PerfGroup>([
      { $match: { createdAt: dateRange(query.from, query.to) } },
      { $group: { _id: '$productId', ...inOutAccumulators() } },
      { $addFields: { net: { $subtract: ['$in', '$out'] } } },
      { $sort: { net: -1, _id: 1 } },
    ]).cursor();
    for await (const group of cursor) {
      yield performanceRow(group, labels);
    }
  }

  // ── Ledger Consistency (FR-RPT-05, Admin) — quantity vs Σ ledger ──────────

  async consistency(query: ReportConsistencyQuery): Promise<ListEnvelope<ConsistencyRow>> {
    const skip = (query.page - 1) * query.limit;
    const [products, totalItems] = await Promise.all([
      Product.find()
        .sort({ sku: 1 })
        .skip(skip)
        .limit(query.limit)
        .select('sku name quantity')
        .lean(),
      Product.countDocuments(),
    ]);

    const ids = products.map((p) => p._id);
    const sums = await ledgerSums(ids);
    return listEnvelope(
      products.map((p) => consistencyRow(p, sums.get(p._id.toString()) ?? 0)),
      query.page,
      query.limit,
      totalItems,
    );
  }

  async *streamConsistency(): AsyncGenerator<ConsistencyRow> {
    // Snapshot ALL ledger sums once (ARB-05 snapshot-consistent), then stream products.
    const sums = await ledgerSums();
    const cursor = Product.find().sort({ sku: 1 }).select('sku name quantity').lean().cursor();
    for await (const product of cursor) {
      const p = product as ConsistencyProductLean;
      yield consistencyRow(p, sums.get(p._id.toString()) ?? 0);
    }
  }
}

// ── shared filters / helpers ──────────────────────────────────────────────

function inventoryFilter(query: ReportInventoryQuery): FilterQuery<ProductDoc> {
  const filter: FilterQuery<ProductDoc> = { isArchived: false };
  if (query.categoryId) filter.categoryId = new Types.ObjectId(query.categoryId);
  if (query.stockStatus === 'OUT_OF_STOCK') filter.quantity = 0;
  else if (query.stockStatus === 'LOW_STOCK') {
    filter.quantity = { $gt: 0 };
    filter.$expr = { $lte: ['$quantity', '$lowStockThreshold'] };
  } else if (query.stockStatus === 'IN_STOCK') {
    filter.$expr = { $gt: ['$quantity', '$lowStockThreshold'] };
  }
  return filter;
}

/** At or below threshold (includes out-of-stock), active only (FR-RPT-02). */
function lowStockFilter(): FilterQuery<ProductDoc> {
  return { isArchived: false, $expr: { $lte: ['$quantity', '$lowStockThreshold'] } };
}

function transactionsFilter(query: ReportTransactionsQuery): FilterQuery<TransactionDoc> {
  const filter: FilterQuery<TransactionDoc> = { createdAt: dateRange(query.from, query.to) };
  if (query.type) filter.type = query.type;
  if (query.productId) filter.productId = new Types.ObjectId(query.productId);
  if (query.userId) filter.userId = new Types.ObjectId(query.userId);
  return filter;
}

/** Inclusive UTC range; a date-only `to` covers its whole day (BR-40 stability). */
function dateRange(from: string, to: string): { $gte: Date; $lte: Date } {
  const end = DATE_ONLY.test(to) ? new Date(`${to}T23:59:59.999Z`) : new Date(to);
  return { $gte: new Date(from), $lte: end };
}

function inOutAccumulators() {
  return {
    in: { $sum: { $cond: [{ $gt: ['$quantityChange', 0] }, '$quantityChange', 0] } },
    out: { $sum: { $cond: [{ $lt: ['$quantityChange', 0] }, { $abs: '$quantityChange' }, 0] } },
  };
}

async function loadCategoryMap(): Promise<Map<string, string>> {
  const categories = await Category.find().select('name').lean();
  return new Map(categories.map((c) => [c._id.toString(), c.name]));
}

// ── ledger label resolution (transactions report) ─────────────────────────

interface LedgerLean extends TransactionDoc {
  _id: Types.ObjectId;
}
interface TransactionLabels {
  products: Map<string, { name: string; sku: string; isArchived: boolean }>;
  users: Map<string, { name: string }>;
}

async function resolveTransactionLabels(
  rows: Pick<TransactionDoc, 'productId' | 'userId'>[],
): Promise<TransactionLabels> {
  const productIds = [...new Set(rows.map((r) => r.productId.toString()))];
  const userIds = [...new Set(rows.map((r) => r.userId.toString()))];
  const [products, users] = await Promise.all([
    Product.find({ _id: { $in: productIds } })
      .select('name sku isArchived')
      .lean(),
    User.find({ _id: { $in: userIds } })
      .select('name')
      .lean(),
  ]);
  return {
    products: new Map(
      products.map((p) => [
        p._id.toString(),
        { name: p.name, sku: p.sku, isArchived: p.isArchived },
      ]),
    ),
    users: new Map(users.map((u) => [u._id.toString(), { name: u.name }])),
  };
}

/** Full label maps for streaming export (bounded catalog + user set). */
async function loadAllLabels(): Promise<TransactionLabels> {
  const [products, users] = await Promise.all([
    Product.find().select('name sku isArchived').lean(),
    User.find().select('name').lean(),
  ]);
  return {
    products: new Map(
      products.map((p) => [
        p._id.toString(),
        { name: p.name, sku: p.sku, isArchived: p.isArchived },
      ]),
    ),
    users: new Map(users.map((u) => [u._id.toString(), { name: u.name }])),
  };
}

function serializeLabeledRow(row: LedgerLean, labels: TransactionLabels): TransactionRowPayload {
  return serializeTransactionRow(row, {
    product: labels.products.get(row.productId.toString()),
    user: labels.users.get(row.userId.toString()),
  });
}

// ── product label resolution (performance report) ─────────────────────────

type ProductLabelMap = Map<string, { name: string; sku: string }>;

async function resolveProductLabels(ids: Types.ObjectId[]): Promise<ProductLabelMap> {
  const products = await Product.find({ _id: { $in: ids } })
    .select('name sku')
    .lean();
  return new Map(products.map((p) => [p._id.toString(), { name: p.name, sku: p.sku }]));
}

async function loadAllProductLabels(): Promise<ProductLabelMap> {
  const products = await Product.find().select('name sku').lean();
  return new Map(products.map((p) => [p._id.toString(), { name: p.name, sku: p.sku }]));
}

function performanceRow(group: PerfGroup, labels: ProductLabelMap): ProductPerformanceRow {
  const label = labels.get(group._id.toString());
  return {
    productId: group._id.toString(),
    productSku: label?.sku ?? '',
    productName: label?.name ?? 'Unknown product',
    in: group.in,
    out: group.out,
    net: group.net,
  };
}

// ── consistency ────────────────────────────────────────────────────────────

interface ConsistencyProductLean {
  _id: Types.ObjectId;
  sku: string;
  name: string;
  quantity: number;
}

/** Σ quantityChange per product (all, or a subset by id). */
async function ledgerSums(ids?: Types.ObjectId[]): Promise<Map<string, number>> {
  const match = ids ? [{ $match: { productId: { $in: ids } } }] : [];
  const sums = await Transaction.aggregate<{ _id: Types.ObjectId; sum: number }>([
    ...match,
    { $group: { _id: '$productId', sum: { $sum: '$quantityChange' } } },
  ]);
  return new Map(sums.map((s) => [s._id.toString(), s.sum]));
}

function consistencyRow(product: ConsistencyProductLean, ledgerSum: number): ConsistencyRow {
  return {
    productId: product._id.toString(),
    productSku: product.sku,
    productName: product.name,
    ledgerSum,
    quantity: product.quantity,
    drift: ledgerSum !== product.quantity,
  };
}
