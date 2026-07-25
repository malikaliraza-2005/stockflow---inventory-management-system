/**
 * Reports query schemas — VAL §5 "Reports" (F10 T-a); the six /reports routes
 * (05 §7.8). Historical reports (transactions, product-performance) take a
 * MANDATORY date range: both bounds required, ordered, span ≤ 366 days
 * (VAL §5 vectors — 366 d valid, 367 d rejected, missing `from` rejected). The
 * snapshot reports (inventory, low-stock, consistency) are pagination-only.
 *
 * The export route reuses the NAMED report's own filter schema, keyed by a
 * closed `name` enum (APD-04) — an unknown name is a VALIDATION_ERROR, never an
 * open :name surface.
 *
 * No client mirror: reports are read-only query builders; the frontend composes
 * the same params from URL state (SMP §4) and the server is the sole validator.
 */
import { z } from 'zod';

import { TRANSACTION_TYPES } from '../../models/Transaction.js';
import { isoDate, objectId } from '../primitives.js';

const DAY_MS = 86_400_000;
export const MAX_REPORT_SPAN_DAYS = 366;

/** Derived stock status is filterable on the inventory report (05 §7.8). */
export const STOCK_STATUSES = ['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK'] as const;

const page = z.coerce.number().int().min(1).default(1);
const limit = z.coerce.number().int().min(1).max(100).default(20); // NFR-10

/** Shared mandatory-range guard: both bounds present (schema-required), ordered,
 *  span ≤ 366 d. Runs as a superRefine so inference stays a plain object. */
function refineDateRange(value: { from: string; to: string }, ctx: z.RefinementCtx): void {
  const fromMs = new Date(value.from).getTime();
  const toMs = new Date(value.to).getTime();
  if (fromMs > toMs) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'The start date must be on or before the end date',
      path: ['to'],
    });
    return;
  }
  if ((toMs - fromMs) / DAY_MS > MAX_REPORT_SPAN_DAYS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'The date range must be 366 days or less',
      path: ['to'],
    });
  }
}

export const reportInventoryQuerySchema = z.object({
  page,
  limit,
  categoryId: objectId.optional(),
  stockStatus: z.enum(STOCK_STATUSES).optional(),
});
export type ReportInventoryQuery = z.infer<typeof reportInventoryQuerySchema>;

export const reportLowStockQuerySchema = z.object({ page, limit });
export type ReportLowStockQuery = z.infer<typeof reportLowStockQuerySchema>;

export const reportTransactionsQuerySchema = z
  .object({
    page,
    limit,
    from: isoDate,
    to: isoDate,
    type: z.enum(TRANSACTION_TYPES).optional(),
    productId: objectId.optional(),
    userId: objectId.optional(),
  })
  .superRefine(refineDateRange);
export type ReportTransactionsQuery = z.infer<typeof reportTransactionsQuerySchema>;

export const reportPerformanceQuerySchema = z
  .object({ page, limit, from: isoDate, to: isoDate })
  .superRefine(refineDateRange);
export type ReportPerformanceQuery = z.infer<typeof reportPerformanceQuerySchema>;

export const reportConsistencyQuerySchema = z.object({ page, limit });
export type ReportConsistencyQuery = z.infer<typeof reportConsistencyQuerySchema>;

/** APD-04: the closed export-name enum — matches the five named report routes. */
export const REPORT_NAMES = [
  'inventory',
  'low-stock',
  'transactions',
  'product-performance',
  'consistency',
] as const;
export type ReportName = (typeof REPORT_NAMES)[number];

export const reportExportParamsSchema = z.object({
  name: z.enum(REPORT_NAMES),
});
export type ReportExportParams = z.infer<typeof reportExportParamsSchema>;
