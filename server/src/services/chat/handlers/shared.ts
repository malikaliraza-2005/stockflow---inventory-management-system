/**
 * Handler plumbing shared by the three intents.
 *
 * ── The one architectural rule ────────────────────────────────────────────
 *   ChatService → existing service → Mongoose → MongoDB
 *
 * NEVER ChatService → HTTP → own controller → service. An internal REST call
 * would re-run authentication with a forwarded token, double the latency, and —
 * the real problem — start a NEW request chain with its own `AsyncLocalStorage`
 * store, decoupling tenant context from the chat request. Direct service calls
 * stay on the original async chain, so `tenantScopePlugin` keeps scoping
 * automatically and fails closed if it ever does not.
 *
 * Corollary: handlers must never be moved to a queue, a detached promise or a
 * background worker.
 */
import type { HydratedDocument } from 'mongoose';

import { Category, CATEGORY_NAME_COLLATION } from '../../../models/Category.js';
import type { ProductDoc } from '../../../models/Product.js';
import { serializeProductRow } from '../../../serializers/product.js';
import type { ProductService } from '../../ProductService.js';
import type { TransactionService } from '../../TransactionService.js';
import type { ProductsQuery } from '../../../validation/schemas/products.js';
import type { ChatFallback } from '../fallback.js';
import type { ChatResult, ProductSummary } from '../types.js';

export interface ChatHandlerDeps {
  products: ProductService;
  transactions: TransactionService;
  /** Injected clock — period resolution is tested without freezing global time. */
  now: () => Date;
}

export interface HandlerOutcome {
  result: ChatResult;
  /** `null` on the success path — logged explicitly so "answered normally" is
   *  filterable rather than inferred from the absence of a field. */
  fallback: ChatFallback | null;
  /** Rows the user actually got. Zero here WITH `NO_RESULTS` on a correctly
   *  classified intent is the signature of slot-extraction failure — the most
   *  common real-world problem, and invisible without both fields. */
  resultCount: number;
}

/**
 * Slot normalisation (RISK-2). Plural forms ("laptops" vs a stored "Laptop"),
 * retained filler and stray whitespace all silently return zero rows, and a zero
 * result is indistinguishable from "we don't stock it". Prompt rule 3 handles
 * most of it; this is the belt to that pair of braces.
 */
export function normaliseSlot(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const cleaned = value.trim().replace(/\s+/g, ' ');
  return cleaned === '' ? undefined : cleaned;
}

/** "laptops" → "laptop". Only worth trying on words long enough that dropping a
 *  character still leaves something distinctive, and never on "ss" endings. */
export function singularise(value: string): string | undefined {
  if (value.length <= 3) return undefined;
  if (!/[^s]s$/i.test(value)) return undefined;
  return value.slice(0, -1);
}

/** Never widen below this — a 3-character fragment matches most catalogues. */
const MIN_VARIANT = 4;

/**
 * Progressively looser search terms, most specific first.
 *
 * Retrieval here is a LITERAL substring regex (ProductService.list), which is
 * exact in a way people are not. A user asking for "Barca Jersey" against a
 * catalogue holding "FC Barcelona Jersey" gets nothing — and neither would a
 * perfect classifier emitting "Barca", because "Barca" is not a substring of
 * "Barcelona". No amount of prompt tuning fixes that; it is a retrieval gap,
 * not a language one.
 *
 * So the handler widens on its own, in order:
 *   1. the phrase as given
 *   2. its singular ("Jerseys" → "Jersey")
 *   3. each word alone, LONGEST FIRST — the longest word is the most
 *      distinctive one available, and "Barca Jersey" → "Jersey" at least
 *      returns the jerseys
 *   4. a stem of the longest word, which is what finally bridges an
 *      abbreviation to its full form ("Barca" → "Barc" → "FC Barcelona Jersey")
 *
 * The caller stops at the first variant that returns anything, and the reply
 * SAYS which term actually produced the rows. Widening silently would be the
 * unacceptable version: the user would think they had searched for one thing
 * while reading results for another.
 */
export function searchVariants(term: string): string[] {
  const variants: string[] = [];
  const seen = new Set<string>();

  const add = (value: string | undefined): void => {
    if (value === undefined) return;
    const trimmed = value.trim();
    if (trimmed.length < 2) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    variants.push(trimmed);
  };

  add(term);
  add(singularise(term));

  const words = term
    .split(/\s+/)
    .filter((word) => word.length >= 2)
    .sort((a, b) => b.length - a.length);
  for (const word of words) {
    add(word);
    add(singularise(word));
  }

  // Last resort. Bounded to two characters so it stays a stem rather than
  // becoming a wildcard.
  const longest = words[0];
  if (longest !== undefined && longest.length > MIN_VARIANT) {
    add(longest.slice(0, Math.max(MIN_VARIANT, longest.length - 2)));
  }

  return variants;
}

export interface ProductSearchResult {
  listed: Awaited<ReturnType<ProductService['list']>>;
  /** The variant that actually returned rows — may be looser than what was asked. */
  matched: string;
  /** True when we had to widen; the templates must disclose this. */
  widened: boolean;
}

/**
 * Run the relaxation ladder until something matches. Each rung is one indexed
 * query, and the ladder is short (≤ 5 for a two-word phrase), so the worst case
 * is bounded — but it stops at the FIRST hit, so the common case is one query.
 */
export async function searchProducts(
  products: ProductService,
  term: string,
  query: Partial<Omit<ProductsQuery, 'archived' | 'search'>>,
): Promise<ProductSearchResult> {
  const variants = searchVariants(term);
  let first: ProductSearchResult | undefined;

  for (const variant of variants) {
    const listed = await products.list(productsQuery({ ...query, search: variant }));
    const result = {
      listed,
      matched: variant,
      widened: variant.toLowerCase() !== term.toLowerCase(),
    };
    first ??= result;
    if (listed.totalItems > 0) return result;
  }
  // Nothing matched at any width — report against the term the user actually used.
  return (
    first ?? { listed: await products.list(productsQuery(query)), matched: term, widened: false }
  );
}

/**
 * A COMPLETE `ProductsQuery`. `ProductService.list` reads `sort`, `order`,
 * `page` and `limit` directly — their defaults live in `productsQuerySchema`,
 * not in the service — so a partial object would put `undefined` into a sort
 * spec. And `archived` is never passed: it is Admin-gated in the products
 * controller, and forwarding it from chat would route around that gate.
 */
export function productsQuery(
  overrides: Partial<Omit<ProductsQuery, 'archived'>> = {},
): ProductsQuery {
  return {
    page: 1,
    limit: 10,
    sort: 'name',
    order: 'asc',
    ...overrides,
  };
}

/**
 * Resolve a spoken category name to its id. The per-tenant unique index uses the
 * `{locale:'en', strength:2}` collation, so an exact-but-case-insensitive lookup
 * already rides the index — no regex needed.
 *
 * Returns `undefined` when nothing matches, and the CALLER falls back to
 * treating the phrase as a search term. That single fallback covers most real
 * phrasing, because "laptops" is a category to one tenant and a name fragment
 * to the next.
 */
export async function resolveCategoryId(name: string): Promise<string | undefined> {
  const category = await Category.findOne({ name })
    .collation(CATEGORY_NAME_COLLATION)
    .select('_id')
    .lean();
  return category?._id.toString();
}

/** Rows on the wire are the EXISTING `/products` list shape, verbatim — the
 *  client reuses its generated types and its product table components. Money
 *  stays a 2-dp string from that serializer; never `Number(price)` in chat. */
export function toProductSummaries(
  rows: HydratedDocument<ProductDoc>[],
  categoryNames: Map<string, string>,
): ProductSummary[] {
  return rows.map((row) =>
    serializeProductRow(row, { categoryName: categoryNames.get(row.categoryId.toString()) }),
  );
}

/** Report `product.quantity` AS STORED — never recomputed from the ledger. Chat
 *  must show the same number as the products page: during any reconciliation
 *  drift an independently-derived figure would make chat and UI disagree, and
 *  users then trust neither. */
export function totalOnHand(rows: ProductSummary[]): number {
  return rows.reduce((sum, row) => sum + row.quantity, 0);
}
