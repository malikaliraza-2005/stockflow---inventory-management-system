/**
 * DashboardService — the single cached aggregate behind GET /dashboard/summary
 * (F9, FR-DASH-01…04). All metrics + both chart series come from ONE call
 * (FR-DASH-03), computed from the ledger + catalog and served from a per-instance
 * cache (NFR-11, A-2) whose age is surfaced as `asOf` (BR-25 honest staleness).
 *
 * READ-ONLY. Like TransactionService it never writes; it aggregates. Totals
 * exclude archived products (05 §7.7); the value scan over active products is the
 * deliberate accepted cost the cache amortizes (DBD §3). Chart series and recent
 * rows span ALL products — activity is activity even for a since-archived item.
 *
 * Cache: keyed by range, TTL in [30, 60] s (A-2). A hit re-serves the frozen
 * payload — including its `asOf` — so a just-archived product may linger up to
 * one TTL (BR-25, the stated bound). `now`/`cacheTtlMs` are injected so the
 * staleness-bound test is deterministic (the F1 injected-clock precedent).
 */
import { Types } from 'mongoose';

import { requireTenantId } from '../lib/tenantContext.js';
import { Product } from '../models/Product.js';
import { Transaction, type TransactionDoc } from '../models/Transaction.js';
import { User } from '../models/User.js';
import {
  aggregateMoney,
  serializeAlertItem,
  type AlertProductLean,
  type DashboardSummaryPayload,
  type MovementTrendPoint,
  type TransactionVolumePoint,
} from '../serializers/dashboard.js';
import { serializeTransactionRow } from '../serializers/transaction.js';
import type { DashboardRange } from '../validation/schemas/dashboard.js';

const DAY_MS = 86_400_000;
/** Cache TTL — 45 s sits in the A-2 [30, 60] s window. */
const DEFAULT_CACHE_TTL_MS = 45_000;
/** WIR §4 alert lists are a preview; the full lists are the F10 low-stock report. */
const ALERT_ITEMS_LIMIT = 5;
/** FR-DASH-01: the 10 most recent ledger rows. */
const RECENT_TRANSACTIONS_LIMIT = 10;
const ALERT_FIELDS = 'name sku quantity lowStockThreshold';

export interface DashboardServiceDeps {
  /** Override for the A-2 window; must stay in [30, 60] s in production. */
  cacheTtlMs?: number;
  /** Injected clock (ms) — defaults to Date.now; overridden in cache tests. */
  now?: () => number;
}

interface CacheEntry {
  payload: DashboardSummaryPayload;
  expiresAt: number;
}

interface TotalsRow {
  activeProducts: number;
  unitsInStock: number;
  inventoryValue: Types.Decimal128 | number;
}

interface ChartRow {
  _id: string; // UTC day key
  in: number;
  out: number;
  count: number;
}

export class DashboardService {
  // SaaS: the cache is keyed by `<tenantId>:<range>` — NEVER by range alone, or
  // one tenant's request would serve another tenant's cached payload (a
  // cross-tenant leak the isolation suite guards against).
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs: number;
  private readonly now: () => number;

  constructor(deps: DashboardServiceDeps = {}) {
    this.cacheTtlMs = deps.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.now = deps.now ?? Date.now;
  }

  async getSummary(range: DashboardRange): Promise<DashboardSummaryPayload> {
    const now = this.now();
    const cacheKey = `${requireTenantId().toString()}:${range}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.payload;

    const payload = await this.compute(range, now);
    this.cache.set(cacheKey, { payload, expiresAt: now + this.cacheTtlMs });
    return payload;
  }

  private async compute(range: DashboardRange, now: number): Promise<DashboardSummaryPayload> {
    // Chart window: `range` UTC days ending today (inclusive).
    const todayStart = startOfUtcDay(now);
    const since = new Date(todayStart.getTime() - (range - 1) * DAY_MS);

    const [totals, lowStock, outOfStock, recentTransactions, charts] = await Promise.all([
      this.computeTotals(),
      this.computeLowStock(),
      this.computeOutOfStock(),
      this.computeRecentTransactions(),
      this.computeCharts(since, range),
    ]);

    return {
      asOf: new Date(now).toISOString(),
      totals,
      lowStock,
      outOfStock,
      recentTransactions,
      charts,
    };
  }

  /** Active-product totals — count, units, and Σ(cost × quantity) as money. */
  private async computeTotals(): Promise<DashboardSummaryPayload['totals']> {
    const rows = await Product.aggregate<TotalsRow>([
      { $match: { isArchived: false } },
      {
        $group: {
          _id: null,
          activeProducts: { $sum: 1 },
          unitsInStock: { $sum: '$quantity' },
          inventoryValue: { $sum: { $multiply: ['$costPrice', '$quantity'] } },
        },
      },
    ]);
    const row = rows[0];
    return {
      activeProducts: row?.activeProducts ?? 0,
      unitsInStock: row?.unitsInStock ?? 0,
      inventoryValue: aggregateMoney(row?.inventoryValue ?? null),
    };
  }

  /** 0 < quantity ≤ threshold, active only. Sorted nearest-to-empty first. */
  private async computeLowStock(): Promise<DashboardSummaryPayload['lowStock']> {
    const filter = {
      isArchived: false,
      quantity: { $gt: 0 },
      $expr: { $lte: ['$quantity', '$lowStockThreshold'] },
    };
    const [count, items] = await Promise.all([
      Product.countDocuments(filter),
      Product.find(filter)
        .sort({ quantity: 1 })
        .limit(ALERT_ITEMS_LIMIT)
        .select(ALERT_FIELDS)
        .lean(),
    ]);
    return { count, items: (items as AlertProductLean[]).map(serializeAlertItem) };
  }

  /** quantity === 0, active only. Most-recently emptied first. */
  private async computeOutOfStock(): Promise<DashboardSummaryPayload['outOfStock']> {
    const filter = { isArchived: false, quantity: 0 };
    const [count, items] = await Promise.all([
      Product.countDocuments(filter),
      Product.find(filter)
        .sort({ updatedAt: -1 })
        .limit(ALERT_ITEMS_LIMIT)
        .select(ALERT_FIELDS)
        .lean(),
    ]);
    return { count, items: (items as AlertProductLean[]).map(serializeAlertItem) };
  }

  /** The 10 most recent ledger rows with resolved product + user labels. */
  private async computeRecentTransactions(): Promise<
    DashboardSummaryPayload['recentTransactions']
  > {
    const rows = await Transaction.find()
      .sort({ createdAt: -1 })
      .limit(RECENT_TRANSACTIONS_LIMIT)
      .lean();
    if (rows.length === 0) return [];

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
    const productLabels = new Map(
      products.map((p) => [
        p._id.toString(),
        { name: p.name, sku: p.sku, isArchived: p.isArchived },
      ]),
    );
    const userLabels = new Map(users.map((u) => [u._id.toString(), { name: u.name }]));

    return (rows as (TransactionDoc & { _id: Types.ObjectId })[]).map((row) =>
      serializeTransactionRow(row, {
        product: productLabels.get(row.productId.toString()),
        user: userLabels.get(row.userId.toString()),
      }),
    );
  }

  /**
   * Both chart series from one grouped scan of the window, then gap-filled to a
   * continuous per-day axis (days with no activity render as zero, not gaps).
   * `in` = Σ positive quantityChange; `out` = Σ |negative| — so adjustments and
   * INITIAL rows fall on the correct side without a type branch.
   */
  private async computeCharts(
    since: Date,
    range: DashboardRange,
  ): Promise<DashboardSummaryPayload['charts']> {
    const grouped = await Transaction.aggregate<ChartRow>([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
          in: { $sum: { $cond: [{ $gt: ['$quantityChange', 0] }, '$quantityChange', 0] } },
          out: {
            $sum: { $cond: [{ $lt: ['$quantityChange', 0] }, { $abs: '$quantityChange' }, 0] },
          },
          count: { $sum: 1 },
        },
      },
    ]);
    const byDay = new Map(grouped.map((g) => [g._id, g]));

    const movementTrend: MovementTrendPoint[] = [];
    const transactionVolume: TransactionVolumePoint[] = [];
    for (let i = 0; i < range; i += 1) {
      const day = new Date(since.getTime() + i * DAY_MS);
      const date = day.toISOString().slice(0, 10);
      const bucket = byDay.get(date);
      movementTrend.push({ date, in: bucket?.in ?? 0, out: bucket?.out ?? 0 });
      transactionVolume.push({ date, count: bucket?.count ?? 0 });
    }
    return { movementTrend, transactionVolume };
  }
}

/** Midnight UTC of the day containing `ms`. */
function startOfUtcDay(ms: number): Date {
  const d = new Date(ms);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
