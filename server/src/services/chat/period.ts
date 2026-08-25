/**
 * Period buckets → a concrete date range, resolved SERVER-SIDE.
 *
 * The model picks a bucket; it never computes a date. Models have no reliable
 * "today" and do date arithmetic badly, and a hallucinated ISO range produces a
 * silently wrong answer — the exact failure mode this whole design exists to
 * make impossible. Here the arithmetic is ours, against the server clock, and
 * the `now` argument makes it testable without freezing global time.
 *
 * Ranges are date-only (`YYYY-MM-DD`) because that is what the ledger query
 * schema accepts; `TransactionService` expands `to` to the end of its UTC day.
 * `last_7_days` means the 7 CALENDAR DAYS ENDING TODAY (today − 6 … today), which
 * is what "the past week" means to a person reading a stock report.
 */
import type { Period } from './intentSchema.js';

export interface PeriodRange {
  from?: string;
  to?: string;
}

function utcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export function resolvePeriod(period: Period, now: Date = new Date()): PeriodRange {
  switch (period) {
    case 'last_7_days':
      return { from: utcDate(daysBefore(now, 6)), to: utcDate(now) };
    case 'last_30_days':
      return { from: utcDate(daysBefore(now, 29)), to: utcDate(now) };
    case 'this_month':
      return {
        from: utcDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))),
        to: utcDate(now),
      };
    case 'all':
      return {};
  }
}

/** Template fragment — appended to movement-history summaries. */
export function periodLabel(period: Period): string {
  switch (period) {
    case 'last_7_days':
      return 'in the last 7 days';
    case 'last_30_days':
      return 'in the last 30 days';
    case 'this_month':
      return 'this month';
    case 'all':
      return 'on record';
  }
}
