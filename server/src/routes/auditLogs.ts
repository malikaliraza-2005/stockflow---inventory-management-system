/**
 * `/audit-logs` router — the read-only Audit Trail (BEA §2, 05 §7.6, F7).
 * Role annotation SPREAD FROM THE GENERATED MATRIX: `audit.view` (Admin only).
 * No write routes exist — the audit trail is append-only (DES-1); the only
 * writer is AuditService inside the T3–T6 boundaries + the security-event path.
 */
import { Router, type RequestHandler } from 'express';

import { rolesFor } from '../config/permissionMatrix.js';
import type { createAuditLogsController } from '../controllers/auditLogsController.js';
import type { createAuthorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { auditLogsQuerySchema } from '../validation/schemas/auditLogs.js';

export interface AuditLogsRouterDeps {
  controller: ReturnType<typeof createAuditLogsController>;
  authenticate: RequestHandler;
  authorize: ReturnType<typeof createAuthorize>;
}

export function createAuditLogsRouter(deps: AuditLogsRouterDeps): Router {
  const { controller, authenticate, authorize } = deps;
  const router = Router();

  const viewAudit = authorize(...rolesFor('audit.view'));

  router.get(
    '/',
    authenticate,
    viewAudit,
    validate(auditLogsQuerySchema, 'query'),
    controller.list,
  );

  return router;
}
