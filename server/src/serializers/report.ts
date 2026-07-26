/**
 * Report row serialization — the wire + CSV contract for the /reports surface
 * (05 §7.8, F10). Each report defines one row shape, its JSON serializer, and
 * its CSV header + column mapper, so the on-screen table and the exported file
 * derive from ONE definition (a truncated export can never disagree with the
 * table). Money stays a 2-dp string (DBR-05); reports value stock at CURRENT
 * cost and say so in the UI footnote (FR-RPT-06, AS-17).
 *
 * Historical reports (transactions, product-performance) are ledger-derived, so
 * re-running a past period is byte-identical (BR-40) — the ledger rows never
 * change and the serializers are pure.
 */
import type { Types } from 'mongoose';

import type { StockStatus } from './product.js';
import { deriveStockStatus } from './product.js';
import type { TransactionRowPayload } from './transaction.js';

/** Decimal128 → fixed 2-dp string. */
function money(value: Types.Decimal128): string {
  return Number(value.toString()).toFixed(2);
}

/** costPrice × quantity as a 2-dp money string (current-cost valuation, AS-17). */
function lineValue(costPrice: Types.Decimal128, quantity: number): string {
  return (Number(costPrice.toString()) * quantity).toFixed(2);
}

// ── Inventory Summary (FR-RPT-01) ──────────────────────────────────────────

export interface InventoryProductLean {
  _id: Types.ObjectId;
  sku: string;
  name: string;
  categoryId: Types.ObjectId;
  costPrice: Types.Decimal128;
  quantity: number;
  lowStockThreshold: number;
}

export interface InventoryReportRow {
  id: string;
  sku: string;
  name: string;
  categoryName: string;
  quantity: number;
  costPrice: string;
  lineValue: string;
  stockStatus: StockStatus;
}

export interface InventoryTotals {
  totalQuantity: number;
  totalValue: string;
}

export function serializeInventoryRow(
  product: InventoryProductLean,
  categoryName: string,
): InventoryReportRow {
  return {
    id: product._id.toString(),
    sku: product.sku,
    name: product.name,
    categoryName,
    quantity: product.quantity,
    costPrice: money(product.costPrice),
    lineValue: lineValue(product.costPrice, product.quantity),
    stockStatus: deriveStockStatus(product.quantity, product.lowStockThreshold),
  };
}

export const INVENTORY_CSV_HEADER = [
  'SKU',
  'Name',
  'Category',
  'Quantity',
  'Cost price',
  'Line value',
  'Status',
];
export function inventoryCsvColumns(row: InventoryReportRow): (string | number)[] {
  return [
    row.sku,
    row.name,
    row.categoryName,
    row.quantity,
    row.costPrice,
    row.lineValue,
    row.stockStatus,
  ];
}

// ── Low Stock (FR-RPT-02) ───────────────────────────────────────────────────

export interface LowStockReportRow {
  id: string;
  sku: string;
  name: string;
  categoryName: string;
  quantity: number;
  lowStockThreshold: number;
  shortage: number;
}

export function serializeLowStockRow(
  product: InventoryProductLean,
  categoryName: string,
): LowStockReportRow {
  return {
    id: product._id.toString(),
    sku: product.sku,
    name: product.name,
    categoryName,
    quantity: product.quantity,
    lowStockThreshold: product.lowStockThreshold,
    shortage: Math.max(product.lowStockThreshold - product.quantity, 0),
  };
}

export const LOW_STOCK_CSV_HEADER = [
  'SKU',
  'Name',
  'Category',
  'Quantity',
  'Threshold',
  'Shortage',
];
export function lowStockCsvColumns(row: LowStockReportRow): (string | number)[] {
  return [row.sku, row.name, row.categoryName, row.quantity, row.lowStockThreshold, row.shortage];
}

// ── Transaction History (FR-RPT-03) — reuses the ledger row ─────────────────

export const TRANSACTIONS_CSV_HEADER = [
  'Time',
  'Product',
  'SKU',
  'Type',
  'Change',
  'After',
  'User',
  'Reason',
  'Note',
];
export function transactionsCsvColumns(row: TransactionRowPayload): (string | number)[] {
  return [
    row.createdAt,
    row.productName,
    row.productSku,
    row.type,
    row.quantityChange,
    row.quantityAfter,
    row.userName,
    row.reason ?? '',
    row.note ?? '',
  ];
}

// ── Product Performance (FR-RPT-04) ─────────────────────────────────────────

export interface ProductPerformanceRow {
  productId: string;
  productSku: string;
  productName: string;
  in: number;
  out: number;
  net: number;
}

export interface PerformanceTotals {
  totalIn: number;
  totalOut: number;
  totalNet: number;
}

export const PERFORMANCE_CSV_HEADER = ['SKU', 'Product', 'In', 'Out', 'Net'];
export function performanceCsvColumns(row: ProductPerformanceRow): (string | number)[] {
  return [row.productSku, row.productName, row.in, row.out, row.net];
}

// ── Ledger Consistency (FR-RPT-05, Admin) ───────────────────────────────────

export interface ConsistencyRow {
  productId: string;
  productSku: string;
  productName: string;
  ledgerSum: number;
  quantity: number;
  drift: boolean;
}

export const CONSISTENCY_CSV_HEADER = ['SKU', 'Product', 'Ledger sum', 'Quantity', 'Drift'];
export function consistencyCsvColumns(row: ConsistencyRow): (string | number)[] {
  return [row.productSku, row.productName, row.ledgerSum, row.quantity, row.drift ? 'DRIFT' : 'OK'];
}
