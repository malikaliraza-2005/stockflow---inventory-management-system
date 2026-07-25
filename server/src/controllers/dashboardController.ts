/**
 * Dashboard controller — HTTP concerns only (BEA §2): validated `range` → the
 * one cached DashboardService summary → straight to the wire. The service owns
 * the composite serialization (it caches the finished payload), so there is no
 * per-row mapping here.
 */
import type { RequestHandler } from 'express';

import { asyncHandler } from '../lib/asyncHandler.js';
import type { DashboardService } from '../services/DashboardService.js';
import type { DashboardSummaryQuery } from '../validation/schemas/dashboard.js';

export function createDashboardController(dashboardService: DashboardService) {
  const summary: RequestHandler = asyncHandler(async (req, res) => {
    const { range } = req.query as unknown as DashboardSummaryQuery;
    res.json(await dashboardService.getSummary(range));
  });

  return { summary };
}
