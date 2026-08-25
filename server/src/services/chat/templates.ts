/**
 * Response templates — the ENTIRE user-facing output of the assistant.
 *
 * There is no LLM response-generation step. Every number below is read off a
 * result set that came out of Mongo through hand-written code; none of it is
 * generated. That single property is why a confidently hallucinated stock
 * figure — the failure that would permanently destroy trust in an inventory
 * system — is structurally impossible here rather than merely unlikely.
 *
 * These strings are the product's visible surface, so they are snapshot-tested:
 * a wording change should show up in a diff and be reviewed like any other
 * change to what the user sees.
 */
import type { TransactionType } from '../../models/Transaction.js';
import { periodLabel } from './period.js';
import type { Period } from './intentSchema.js';
import { CAPABILITY_BLURBS } from './types.js';

/** `1 product` / `3 products` — used everywhere, so it lives in one place. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${String(count)} ${count === 1 ? singular : pluralForm}`;
}

/**
 * What the lookup was actually scoped BY — a text search, a resolved category,
 * or nothing. Kept explicit rather than "a term that might be a category",
 * because the two produce different queries and deserve different sentences:
 * "matching" describes a substring search, and saying it about a category
 * filter quietly misdescribes what the server did.
 */
export type LookupScope =
  | {
      kind: 'term';
      value: string;
      /** Set when the handler WIDENED the search to find anything — this is the
       *  phrase the user actually typed. Disclosed in the summary, because
       *  reading results for "Jersey" while believing you searched for
       *  "Barca Jersey" is worse than being told nothing matched. */
      asked?: string | undefined;
    }
  | { kind: 'category'; value: string }
  | { kind: 'all' };

function scopeClause(scope: LookupScope): string {
  switch (scope.kind) {
    case 'term':
      return ` matching "${scope.value}"`;
    case 'category':
      return ` in "${scope.value}"`;
    case 'all':
      return '';
  }
}

/** Inclusive bounds, rendered so the user can check the filter was understood.
 *  A silent numeric filter is the easiest kind of wrong answer to believe. */
export interface QuantityFilter {
  min?: number | undefined;
  max?: number | undefined;
}

function quantityClause(filter: QuantityFilter | undefined): string {
  if (filter === undefined) return '';
  const { min, max } = filter;
  if (min !== undefined && max !== undefined) {
    return ` with ${String(min)}–${String(max)} units in stock`;
  }
  if (min !== undefined) return ` with ${plural(min, 'unit')} or more in stock`;
  if (max !== undefined) return ` with ${plural(max, 'unit')} or fewer in stock`;
  return '';
}

/** States that the search was relaxed, or '' when it was not. */
function widenedPrefix(scope: LookupScope): string {
  if (scope.kind !== 'term' || scope.asked === undefined) return '';
  return `Nothing matched "${scope.asked}" exactly, so I searched for "${scope.value}" instead. `;
}

// ── product_lookup ────────────────────────────────────────────────────────

export function productLookupFound(args: {
  scope: LookupScope;
  totalCount: number;
  totalOnHand: number;
  quantity?: QuantityFilter | undefined;
}): string {
  return `${widenedPrefix(args.scope)}Found ${plural(args.totalCount, 'product')}${scopeClause(
    args.scope,
  )}${quantityClause(args.quantity)}. Total on hand: ${plural(args.totalOnHand, 'unit')}.`;
}

/** TOO_MANY_RESULTS — the count is stated, so this is never a silent truncation. */
export function productLookupTruncated(args: {
  scope: LookupScope;
  totalCount: number;
  shown: number;
  quantity?: QuantityFilter | undefined;
}): string {
  return `${widenedPrefix(args.scope)}Found ${plural(args.totalCount, 'product')}${scopeClause(
    args.scope,
  )}${quantityClause(
    args.quantity,
  )} — showing the first ${String(args.shown)}. Add a brand or category to narrow it down.`;
}

/** NO_RESULTS — names what was searched, then hands back a concrete next move.
 *  "Try a shorter term" is the single most effective hint, because retained
 *  filler in the slot is the most common cause of an empty result set. */
export function productLookupEmpty(scope: LookupScope, quantity?: QuantityFilter): string {
  const bounded = quantityClause(quantity);
  switch (scope.kind) {
    case 'term':
      return `No products matched "${scope.value}"${bounded}. Try a shorter term — a brand or product name usually works better than a full phrase.`;
    case 'category':
      return `There are no products in "${scope.value}"${bounded} right now.`;
    case 'all':
      return bounded === ''
        ? 'There are no products in the catalogue yet.'
        : `No products${bounded}.`;
  }
}

// ── low_stock ─────────────────────────────────────────────────────────────

/**
 * "Below reorder level" deliberately reports TWO numbers.
 *
 * `ProductService.list` implements `stockStatus: 'low'` as
 * `quantity > 0 AND quantity <= lowStockThreshold` — it EXCLUDES zero-quantity
 * items, which are `'out'`. A user asking "what's below reorder level?" wants
 * both, but out-of-stock is strictly more urgent and folding it into one total
 * loses that. So: run both filters, report them separately.
 */
export function lowStockSummary(args: {
  lowCount: number;
  outCount: number;
  /** Rows actually returned — the counts above are always the FULL totals. */
  shown?: number;
}): string {
  const { lowCount, outCount } = args;
  if (lowCount === 0 && outCount === 0) return 'Nothing is below its reorder level right now.';

  const lowPhrase = `${plural(lowCount, 'product')} ${lowCount === 1 ? 'is' : 'are'} at or below ${
    lowCount === 1 ? 'its' : 'their'
  } reorder level`;
  const outPhrase = `${outCount === 1 ? 'is' : 'are'} out of stock`;

  let sentence: string;
  if (outCount === 0) sentence = `${lowPhrase}.`;
  else if (lowCount === 0) sentence = `${plural(outCount, 'product')} ${outPhrase}.`;
  else sentence = `${lowPhrase}, and ${String(outCount)} ${outPhrase}.`;

  // Truncation is STATED, never silent — a list that quietly stops at 10 reads
  // as "that's all of them" and someone under-orders.
  const shown = args.shown ?? lowCount + outCount;
  return shown < lowCount + outCount
    ? `${sentence} Showing the ${String(shown)} most urgent.`
    : sentence;
}

// ── movement_history ──────────────────────────────────────────────────────

const MOVEMENT_LABELS: Record<TransactionType, [string, string]> = {
  INITIAL: ['opening stock', 'opening stock'],
  STOCK_IN: ['stock-in', 'stock-in'],
  STOCK_OUT: ['stock-out', 'stock-out'],
  ADJUSTMENT: ['adjustment', 'adjustments'],
};

/** "8 stock-in, 3 stock-out, 1 adjustment" — counted from the returned rows. */
export function movementBreakdown(counts: Partial<Record<TransactionType, number>>): string {
  return (Object.keys(MOVEMENT_LABELS) as TransactionType[])
    .filter((type) => (counts[type] ?? 0) > 0)
    .map((type) => {
      const n = counts[type] ?? 0;
      const [one, many] = MOVEMENT_LABELS[type];
      return `${String(n)} ${n === 1 ? one : many}`;
    })
    .join(', ');
}

export function movementHistoryFound(args: {
  productName: string;
  period: Period;
  totalCount: number;
  shown: number;
  counts: Partial<Record<TransactionType, number>>;
}): string {
  const head = `${plural(args.totalCount, 'stock movement')} for "${args.productName}" ${periodLabel(
    args.period,
  )}`;
  const truncated =
    args.shown < args.totalCount ? ` — showing the most recent ${String(args.shown)}` : '';
  const breakdown = movementBreakdown(args.counts);
  return breakdown === '' ? `${head}${truncated}.` : `${head}${truncated}: ${breakdown}.`;
}

export function movementHistoryEmpty(productName: string, period: Period): string {
  return `No stock movements for "${productName}" ${periodLabel(period)}.`;
}

// ── clarify ───────────────────────────────────────────────────────────────

/** AMBIGUOUS_PRODUCT — list the candidates and ask. Never silently pick one:
 *  a history answer for the wrong product is indistinguishable from a right one. */
export function ambiguousProduct(term: string, count: number): string {
  return `I found ${plural(count, 'product')} matching "${term}". Which one did you mean?`;
}

/** SLOT_MISSING — the model classified correctly but named no product. */
export function missingProductSlot(): string {
  return "Which product did you mean? Name a product and I'll show its stock movement history.";
}

// ── unsupported / forbidden ───────────────────────────────────────────────

export function unsupportedSummary(): string {
  return `I can't answer that one. I can help with:\n${CAPABILITY_BLURBS.map(
    (blurb) => `• ${blurb}`,
  ).join('\n')}`;
}

/** FORBIDDEN — refused before the handler runs, so nothing was read. */
export function forbiddenSummary(): string {
  return "You don't have permission to see that information. Ask an administrator if you need access.";
}
