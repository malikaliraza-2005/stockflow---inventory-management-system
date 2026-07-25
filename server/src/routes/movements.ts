/**
 * `/inventory` router — the stock-movement endpoint (BEA §2, 05 §7.5). Role
 * annotations SPREAD FROM THE GENERATED MATRIX (config/permissionMatrix.ts):
 * `movements.stockInOut` (both roles), `movements.adjust` (Admin).
 *
 * ── The validate-before-authorize exception (AAD §5.2) ─────────────────────
 * `POST /inventory/movements` is the ONLY payload-dependent-authorization route:
 * STOCK_IN/STOCK_OUT are Any-role, ADJUSTMENT is Admin-only. Because the role
 * decision needs the validated body's `type`, this route orders `validate`
 * BEFORE the type-aware authorize — the documented, single exception to the
 * standard authorize-before-validate chain (routes own their chains, BEA §2).
 * No other route may adopt payload-dependent authorization without review.
 */
import { Router, type RequestHandler } from 'express';

import { rolesFor } from '../config/permissionMatrix.js';
import type { createMovementsController } from '../controllers/movementsController.js';
import type { createAuthorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { movementSchema } from '../validation/schemas/movements.js';

export interface MovementsRouterDeps {
  controller: ReturnType<typeof createMovementsController>;
  authenticate: RequestHandler;
  authorize: ReturnType<typeof createAuthorize>;
}

export function createMovementsRouter(deps: MovementsRouterDeps): Router {
  const { controller, authenticate, authorize } = deps;
  const router = Router();

  const stockInOut = authorize(...rolesFor('movements.stockInOut'));
  const adjust = authorize(...rolesFor('movements.adjust'));

  // Body is already validated here (chain order below), so `type` is trusted.
  const authorizeByType: RequestHandler = (req, res, next) => {
    const authorizer = req.body?.type === 'ADJUSTMENT' ? adjust : stockInOut;
    authorizer(req, res, next);
  };

  router.post(
    '/movements',
    authenticate,
    validate(movementSchema),
    authorizeByType,
    controller.create,
  );

  return router;
}
