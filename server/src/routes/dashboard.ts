/**
 * `/dashboard` router — the single cached aggregate (BEA §2, 05 §7.7, F9).
 * Role annotation SPREAD FROM THE GENERATED MATRIX: `dashboard.view` (both
 * roles). Read-only; the one route validates `range` against its §5 schema
 * before the controller runs.
 */
import { Router, type RequestHandler } from 'express';

import { rolesFor } from '../config/permissionMatrix.js';
import type { createDashboardController } from '../controllers/dashboardController.js';
import type { createAuthorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { dashboardSummaryQuerySchema } from '../validation/schemas/dashboard.js';

export interface DashboardRouterDeps {
  controller: ReturnType<typeof createDashboardController>;
  authenticate: RequestHandler;
  authorize: ReturnType<typeof createAuthorize>;
}

export function createDashboardRouter(deps: DashboardRouterDeps): Router {
  const { controller, authenticate, authorize } = deps;
  const router = Router();

  const viewDashboard = authorize(...rolesFor('dashboard.view'));

  router.get(
    '/summary',
    authenticate,
    viewDashboard,
    validate(dashboardSummaryQuerySchema, 'query'),
    controller.summary,
  );

  return router;
}
