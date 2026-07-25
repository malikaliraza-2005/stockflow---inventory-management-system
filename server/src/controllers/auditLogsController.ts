/**
 * Audit-logs controller — HTTP concerns only (BEA §2, 05 §7.6, F7). Validated
 * query → the AuditQueryService list → the §5 list envelope. Read-only (Admin);
 * the ledger's sibling append-only read surface (DES-1).
 */
import type { RequestHandler } from 'express';

import { asyncHandler } from '../lib/asyncHandler.js';
import type { AuditQueryService } from '../services/AuditQueryService.js';
import type { AuditLogsQuery } from '../validation/schemas/auditLogs.js';

export function createAuditLogsController(auditQueryService: AuditQueryService) {
  const list: RequestHandler = asyncHandler(async (req, res) => {
    res.json(await auditQueryService.list(req.query as unknown as AuditLogsQuery));
  });

  return { list };
}
