/**
 * `movement_history` — the only intent with a RESOLUTION STEP.
 *
 * Transactions reference `productId`; the user says a name. So: resolve the
 * phrase through `ProductService.list` first, then branch on how many matched —
 *   0  ⇒ no-match reply naming what was searched
 *   1  ⇒ fetch the history
 *   >1 ⇒ ask which, listing the candidates
 *
 * Never silently pick the first match. A movement history for the wrong Dell is
 * indistinguishable, on screen, from the right one — which makes a quiet guess
 * worse than a question.
 */
import { fallback } from '../fallback.js';
import { serializeTransactionRow } from '../../../serializers/transaction.js';
import { resolvePeriod } from '../period.js';
import {
  normaliseSlot,
  productsQuery,
  singularise,
  toProductSummaries,
  type ChatHandlerDeps,
  type HandlerOutcome,
} from './shared.js';
import {
  ambiguousProduct,
  missingProductSlot,
  movementHistoryEmpty,
  movementHistoryFound,
  productLookupEmpty,
} from '../templates.js';
import { EXAMPLE_QUESTIONS, MAX_CANDIDATES, type MovementSummary } from '../types.js';
import type { MovementHistoryIntent } from '../intentSchema.js';
import type { TransactionType } from '../../../models/Transaction.js';

export async function handleMovementHistory(
  intent: MovementHistoryIntent,
  deps: ChatHandlerDeps,
): Promise<HandlerOutcome> {
  const term = normaliseSlot(intent.productQuery);

  if (term === undefined) {
    return {
      result: {
        intent: 'clarify',
        summary: missingProductSlot(),
        candidates: [],
        examples: [...EXAMPLE_QUESTIONS],
      },
      fallback: fallback('SLOT_MISSING', 'productQuery'),
      resultCount: 0,
    };
  }

  // ── resolve ────────────────────────────────────────────────────────────
  let matches = await deps.products.list(productsQuery({ limit: MAX_CANDIDATES, search: term }));
  if (matches.totalItems === 0) {
    const singular = singularise(term);
    if (singular !== undefined) {
      const retry = await deps.products.list(
        productsQuery({ limit: MAX_CANDIDATES, search: singular }),
      );
      if (retry.totalItems > 0) matches = retry;
    }
  }

  if (matches.totalItems === 0) {
    return {
      result: {
        intent: 'product_lookup',
        summary: productLookupEmpty({ kind: 'term', value: term }),
        products: [],
        totalCount: 0,
        examples: [...EXAMPLE_QUESTIONS],
      },
      fallback: fallback('NO_RESULTS'),
      resultCount: 0,
    };
  }

  const candidates = toProductSummaries(matches.data, matches.categoryNames);
  // An EXACT name or SKU hit is not "picking the first" — it is the user having
  // named the product unambiguously while a substring search dragged in others
  // ("Dell XPS 15" also matching "Dell XPS 15 Dock").
  const exact = candidates.find(
    (row) =>
      row.name.toLowerCase() === term.toLowerCase() || row.sku.toLowerCase() === term.toLowerCase(),
  );
  const product = matches.totalItems === 1 ? candidates[0] : exact;

  if (product === undefined) {
    return {
      result: {
        intent: 'clarify',
        summary: ambiguousProduct(term, matches.totalItems),
        candidates,
        examples: [],
      },
      fallback: fallback('AMBIGUOUS_PRODUCT'),
      resultCount: candidates.length,
    };
  }

  // ── fetch ──────────────────────────────────────────────────────────────
  const range = resolvePeriod(intent.period, deps.now());
  const ledger = await deps.transactions.list({
    page: 1,
    limit: intent.limit,
    productId: product.id,
    // An explicit product filter already wins over the archived-hide rule in
    // TransactionService; stating it here keeps the intent visible at the call site.
    includeArchived: true,
    ...range,
  });

  const movements: MovementSummary[] = ledger.data.map((row) =>
    serializeTransactionRow(row, {
      product: ledger.products.get(row.productId.toString()),
      user: ledger.users.get(row.userId.toString()),
    }),
  );

  if (ledger.totalItems === 0) {
    return {
      result: {
        intent: 'movement_history',
        summary: movementHistoryEmpty(product.name, intent.period),
        product,
        movements: [],
        totalCount: 0,
        examples: [...EXAMPLE_QUESTIONS],
      },
      fallback: fallback('NO_RESULTS'),
      resultCount: 0,
    };
  }

  const counts: Partial<Record<TransactionType, number>> = {};
  for (const row of ledger.data) {
    counts[row.type] = (counts[row.type] ?? 0) + 1;
  }

  return {
    result: {
      intent: 'movement_history',
      summary: movementHistoryFound({
        productName: product.name,
        period: intent.period,
        totalCount: ledger.totalItems,
        shown: movements.length,
        counts,
      }),
      product,
      movements,
      totalCount: ledger.totalItems,
      examples: [],
    },
    fallback: ledger.totalItems > movements.length ? fallback('TOO_MANY_RESULTS') : null,
    resultCount: movements.length,
  };
}
