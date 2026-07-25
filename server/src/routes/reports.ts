/**
 * `/reports` router — the five named reports + the Admin CSV export (BEA §2,
 * 05 §7.8, F10). Roles SPREAD FROM THE GENERATED MATRIX: inventory/low-stock/
 * transactions/product-performance are `reports.view` (both roles); consistency
 * is `reports.consistency` (Admin); export is `reports.export` (Admin — the 403
 * is enforced HERE at the API, before any bytes stream). Every route validates
 * its filters before the controller; the export validates only its `name` enum
 * (APD-04) — the filter re-validation happens in the controller once `name` is known.
 *
 * Named single-segment routes are declared before `/:name/export` so the closed
 * report names can never be shadowed by the param route.
 */
import { Router, type RequestHandler } from 'express';

import { rolesFor } from '../config/permissionMatrix.js';
import type { createReportsController } from '../controllers/reportsController.js';
import type { createAuthorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import {
  reportConsistencyQuerySchema,
  reportExportParamsSchema,
  reportInventoryQuerySchema,
  reportLowStockQuerySchema,
  reportPerformanceQuerySchema,
  reportTransactionsQuerySchema,
} from '../validation/schemas/reports.js';

export interface ReportsRouterDeps {
  controller: ReturnType<typeof createReportsController>;
  authenticate: RequestHandler;
  authorize: ReturnType<typeof createAuthorize>;
}

export function createReportsRouter(deps: ReportsRouterDeps): Router {
  const { controller, authenticate, authorize } = deps;
  const router = Router();

  const view = authorize(...rolesFor('reports.view'));
  const consistencyGate = authorize(...rolesFor('reports.consistency'));
  const exportGate = authorize(...rolesFor('reports.export'));

  router.get(
    '/inventory',
    authenticate,
    view,
    validate(reportInventoryQuerySchema, 'query'),
    controller.inventory,
  );
  router.get(
    '/low-stock',
    authenticate,
    view,
    validate(reportLowStockQuerySchema, 'query'),
    controller.lowStock,
  );
  router.get(
    '/transactions',
    authenticate,
    view,
    validate(reportTransactionsQuerySchema, 'query'),
    controller.transactions,
  );
  router.get(
    '/product-performance',
    authenticate,
    view,
    validate(reportPerformanceQuerySchema, 'query'),
    controller.performance,
  );
  router.get(
    '/consistency',
    authenticate,
    consistencyGate,
    validate(reportConsistencyQuerySchema, 'query'),
    controller.consistency,
  );
  router.get(
    '/:name/export',
    authenticate,
    exportGate,
    validate(reportExportParamsSchema, 'params'),
    controller.exportReport,
  );

  return router;
}
