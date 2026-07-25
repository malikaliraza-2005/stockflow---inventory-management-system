/**
 * `/transactions` router — the read-only Stock Ledger (BEA §2, 05 §7.6, F7).
 * Role annotation SPREAD FROM THE GENERATED MATRIX: `transactions.view` (both
 * roles). No write routes exist — the ledger is append-only (DES-1); the only
 * writer is MovementService via POST /inventory/movements.
 */
import { Router, type RequestHandler } from 'express';

import { rolesFor } from '../config/permissionMatrix.js';
import type { createTransactionsController } from '../controllers/transactionsController.js';
import type { createAuthorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { transactionsQuerySchema } from '../validation/schemas/transactions.js';

export interface TransactionsRouterDeps {
  controller: ReturnType<typeof createTransactionsController>;
  authenticate: RequestHandler;
  authorize: ReturnType<typeof createAuthorize>;
}

export function createTransactionsRouter(deps: TransactionsRouterDeps): Router {
  const { controller, authenticate, authorize } = deps;
  const router = Router();

  const viewTransactions = authorize(...rolesFor('transactions.view'));

  router.get(
    '/',
    authenticate,
    viewTransactions,
    validate(transactionsQuerySchema, 'query'),
    controller.list,
  );

  return router;
}
