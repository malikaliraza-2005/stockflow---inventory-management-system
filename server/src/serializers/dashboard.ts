/**
 * Dashboard summary serialization — the wire contract for GET /dashboard/summary
 * (05 §7.7, F9). One cached composite (NFR-11): totals + stock alerts + the 10
 * most recent ledger rows + both chart series, stamped with `asOf` (BR-25).
 *
 * Conventions held from the global contract (05 §2): money as a 2-dp string
 * (DBR-05 — `inventoryValue`), dates ISO-8601 UTC (`asOf`, `date` buckets are
 * UTC day keys), optional-sparse fields absent. Recent rows reuse the ledger
 * serializer verbatim so a dashboard row and a Stock-Ledger row are identical.
 *
 * The assembled payload is what DashboardService caches, so serialization runs
 * once per cache miss — a cache hit re-serves the frozen wire object (and its
 * frozen `asOf`), which is exactly the honest-staleness contract (BR-25).
 */
import type { Types } from 'mongoose';

import type { TransactionRowPayload } from './transaction.js';

/** A low/out-of-stock preview entry — links to the product + its pre-filled
 *  Stock In action in the UI (FR-DASH-04). `quantity`/`lowStockThreshold` let
 *  the low-stock list render "qty / threshold" (WIR §4). */
export interface DashboardAlertItem {
  id: string;
  name: string;
  sku: string;
  quantity: number;
  lowStockThreshold: number;
}

export interface DashboardTotals {
  activeProducts: number;
  /** Σ (current cost × quantity) over active products — money string (AS-17). */
  inventoryValue: string;
  unitsInStock: number;
}

/** One day of the movement-trend series (in vs out) — FR-DASH-02. */
export interface MovementTrendPoint {
  date: string; // UTC day key, YYYY-MM-DD
  in: number;
  out: number;
}

/** One day of transaction volume — FR-DASH-02. */
export interface TransactionVolumePoint {
  date: string; // UTC day key, YYYY-MM-DD
  count: number;
}

export interface DashboardSummaryPayload {
  asOf: string;
  totals: DashboardTotals;
  lowStock: { count: number; items: DashboardAlertItem[] };
  outOfStock: { count: number; items: DashboardAlertItem[] };
  recentTransactions: TransactionRowPayload[];
  charts: {
    movementTrend: MovementTrendPoint[];
    transactionVolume: TransactionVolumePoint[];
  };
}

/** The lean product projection the alert lists consume. */
export interface AlertProductLean {
  _id: Types.ObjectId;
  name: string;
  sku: string;
  quantity: number;
  lowStockThreshold: number;
}

export function serializeAlertItem(product: AlertProductLean): DashboardAlertItem {
  return {
    id: product._id.toString(),
    name: product.name,
    sku: product.sku,
    quantity: product.quantity,
    lowStockThreshold: product.lowStockThreshold,
  };
}

/**
 * Decimal128 | number | null (from a $sum that may match nothing) → 2-dp money
 * string. Aggregation returns Decimal128 for a Decimal sum; an empty group
 * yields no row at all, so the caller passes 0 for "no active products".
 */
export function aggregateMoney(value: Types.Decimal128 | number | null | undefined): string {
  if (value === null || value === undefined) return '0.00';
  return Number(value.toString()).toFixed(2);
}
