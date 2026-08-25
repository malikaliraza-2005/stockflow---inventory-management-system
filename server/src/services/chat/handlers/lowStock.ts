/**
 * `low_stock` — "which products are below reorder level?"
 *
 * Runs `ProductService.list` TWICE, because the existing `stockStatus` filter
 * splits the question in two: `'low'` is `quantity > 0 AND quantity <=
 * lowStockThreshold` and therefore EXCLUDES zero-quantity items, which are
 * `'out'`. A user asking what's below reorder level wants both — but out-of-
 * stock is strictly more urgent, so we report the two buckets separately rather
 * than inheriting the existing filter's boundary by accident.
 *
 * Sorted by quantity ascending: most urgent first is the only useful order for
 * a restocking list.
 */
import { fallback } from '../fallback.js';
import {
  productsQuery,
  toProductSummaries,
  type ChatHandlerDeps,
  type HandlerOutcome,
} from './shared.js';
import { lowStockSummary } from '../templates.js';
import { EXAMPLE_QUESTIONS } from '../types.js';
import type { LowStockIntent } from '../intentSchema.js';

export async function handleLowStock(
  intent: LowStockIntent,
  deps: ChatHandlerDeps,
): Promise<HandlerOutcome> {
  const query = { limit: intent.limit, sort: 'quantity', order: 'asc' } as const;

  const [lowList, outList] = await Promise.all([
    deps.products.list(productsQuery({ ...query, stockStatus: 'low' })),
    deps.products.list(productsQuery({ ...query, stockStatus: 'out' })),
  ]);

  const low = toProductSummaries(lowList.data, lowList.categoryNames);
  const out = toProductSummaries(outList.data, outList.categoryNames);
  const resultCount = low.length + out.length;

  // "Nothing is below its reorder level" is a real, useful answer — not a
  // failure — so it does NOT carry NO_RESULTS. Marking it as a fallback would
  // pollute the zero-result rate that the slot-extraction alert watches.
  return {
    result: {
      intent: 'low_stock',
      summary: lowStockSummary({
        lowCount: lowList.totalItems,
        outCount: outList.totalItems,
        shown: resultCount,
      }),
      low,
      out,
      examples: resultCount === 0 ? [...EXAMPLE_QUESTIONS] : [],
    },
    fallback:
      lowList.totalItems > low.length || outList.totalItems > out.length
        ? fallback('TOO_MANY_RESULTS')
        : null,
    resultCount,
  };
}
