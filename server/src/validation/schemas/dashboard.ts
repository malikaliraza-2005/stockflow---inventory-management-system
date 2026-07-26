/**
 * Dashboard query schema — VAL §5 "Dashboard" (F9 T-a); the GET
 * /dashboard/summary parameter (05 §7.7). One selectable window drives every
 * metric and both chart series (FR-DASH-02/03).
 *
 * `range` is a closed set {7, 30, 90} days (VAL §5 vectors: 7/90 valid, 14
 * rejected). It arrives as a query string, so coerce to number BEFORE the enum
 * check; absent → 30 (the WIR §4 default toggle). No client mirror is required
 * for a single toggle value — the frontend picks from a fixed 7/30/90 control.
 */
import { z } from 'zod';

/** The three FR-DASH-02 windows, in days. */
export const DASHBOARD_RANGES = [7, 30, 90] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

export const dashboardSummaryQuerySchema = z.object({
  range: z.coerce
    .number()
    .refine(
      (value): value is DashboardRange => DASHBOARD_RANGES.includes(value as DashboardRange),
      {
        message: 'Range must be 7, 30, or 90 days',
      },
    )
    .default(30),
});

export type DashboardSummaryQuery = z.infer<typeof dashboardSummaryQuerySchema>;
