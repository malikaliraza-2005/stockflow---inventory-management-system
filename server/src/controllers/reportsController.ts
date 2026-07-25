/**
 * Reports controller — HTTP concerns only (BEA §2, 05 §7.8, F10). The five
 * named reports return the §5 envelope (+ a totals row where defined); the
 * export route streams `text/csv` of the FULL filtered dataset.
 *
 * Export dispatch: the route has already validated `name` (the closed enum) and
 * the Admin gate; the same filters as the named report are re-validated HERE
 * against that report's own query schema (the route can't pick the schema until
 * `name` is known). Streaming obeys the ERR §7 first-batch/destroy policy via
 * streamCsv; a post-headers failure is logged with the correlation ID (req.log).
 */
import type { RequestHandler } from 'express';
import type { z } from 'zod';

import { ValidationError, type FieldIssue } from '../errors/AppError.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { streamCsv } from '../lib/csvStream.js';
import {
  CONSISTENCY_CSV_HEADER,
  INVENTORY_CSV_HEADER,
  LOW_STOCK_CSV_HEADER,
  PERFORMANCE_CSV_HEADER,
  TRANSACTIONS_CSV_HEADER,
  consistencyCsvColumns,
  inventoryCsvColumns,
  lowStockCsvColumns,
  performanceCsvColumns,
  transactionsCsvColumns,
} from '../serializers/report.js';
import type { ReportService } from '../services/ReportService.js';
import {
  reportConsistencyQuerySchema,
  reportInventoryQuerySchema,
  reportLowStockQuerySchema,
  reportPerformanceQuerySchema,
  reportTransactionsQuerySchema,
  type ReportConsistencyQuery,
  type ReportExportParams,
  type ReportInventoryQuery,
  type ReportLowStockQuery,
  type ReportPerformanceQuery,
  type ReportTransactionsQuery,
} from '../validation/schemas/reports.js';

export function createReportsController(reportService: ReportService) {
  const inventory: RequestHandler = asyncHandler(async (req, res) => {
    res.json(await reportService.inventory(req.query as unknown as ReportInventoryQuery));
  });

  const lowStock: RequestHandler = asyncHandler(async (req, res) => {
    res.json(await reportService.lowStock(req.query as unknown as ReportLowStockQuery));
  });

  const transactions: RequestHandler = asyncHandler(async (req, res) => {
    res.json(await reportService.transactions(req.query as unknown as ReportTransactionsQuery));
  });

  const performance: RequestHandler = asyncHandler(async (req, res) => {
    res.json(await reportService.performance(req.query as unknown as ReportPerformanceQuery));
  });

  const consistency: RequestHandler = asyncHandler(async (req, res) => {
    res.json(await reportService.consistency(req.query as unknown as ReportConsistencyQuery));
  });

  /** Admin CSV export — streams the full filtered dataset (ERR §7). */
  const exportReport: RequestHandler = asyncHandler(async (req, res) => {
    const { name } = req.params as unknown as ReportExportParams;
    const onStreamError = (error: unknown) =>
      req.log.error({ err: error, report: name }, 'CSV export stream failed after headers');

    switch (name) {
      case 'inventory': {
        const query = parseExportQuery(reportInventoryQuerySchema, req.query);
        await streamCsv(res, {
          filename: 'inventory-report.csv',
          header: INVENTORY_CSV_HEADER,
          rows: reportService.streamInventory(query),
          toColumns: inventoryCsvColumns,
          onStreamError,
        });
        return;
      }
      case 'low-stock': {
        parseExportQuery(reportLowStockQuerySchema, req.query);
        await streamCsv(res, {
          filename: 'low-stock-report.csv',
          header: LOW_STOCK_CSV_HEADER,
          rows: reportService.streamLowStock(),
          toColumns: lowStockCsvColumns,
          onStreamError,
        });
        return;
      }
      case 'transactions': {
        const query = parseExportQuery(reportTransactionsQuerySchema, req.query);
        await streamCsv(res, {
          filename: 'transactions-report.csv',
          header: TRANSACTIONS_CSV_HEADER,
          rows: reportService.streamTransactions(query),
          toColumns: transactionsCsvColumns,
          onStreamError,
        });
        return;
      }
      case 'product-performance': {
        const query = parseExportQuery(reportPerformanceQuerySchema, req.query);
        await streamCsv(res, {
          filename: 'product-performance-report.csv',
          header: PERFORMANCE_CSV_HEADER,
          rows: reportService.streamPerformance(query),
          toColumns: performanceCsvColumns,
          onStreamError,
        });
        return;
      }
      case 'consistency': {
        parseExportQuery(reportConsistencyQuerySchema, req.query);
        await streamCsv(res, {
          filename: 'consistency-report.csv',
          header: CONSISTENCY_CSV_HEADER,
          rows: reportService.streamConsistency(),
          toColumns: consistencyCsvColumns,
          onStreamError,
        });
        return;
      }
    }
  });

  return { inventory, lowStock, transactions, performance, consistency, exportReport };
}

/** Re-validate the export query against the named report's schema (VAL §9 shape). */
function parseExportQuery<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const details: FieldIssue[] = result.error.issues.map((issue) => ({
      field: issue.path.join('.') || '(query)',
      message: issue.message,
    }));
    throw new ValidationError(details);
  }
  return result.data;
}
