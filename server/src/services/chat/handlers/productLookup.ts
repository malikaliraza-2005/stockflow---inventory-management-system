/**
 * `product_lookup` — "How many laptops are available?" and "Show me the
 * inventory of Dell laptops" are the SAME query with different phrasing.
 * Merging them into one intent was the single biggest simplification available
 * in this design; keep them merged.
 *
 * A thin adapter over `ProductService.list`, whose `search` builds an
 * unanchored, case-insensitive regex over name/sku/barcode — so "laptop"
 * already matches "Dell Laptop 15" without any work here.
 */
import { fallback } from '../fallback.js';
import {
  normaliseSlot,
  productsQuery,
  resolveCategoryId,
  singularise,
  toProductSummaries,
  totalOnHand,
  type ChatHandlerDeps,
  type HandlerOutcome,
} from './shared.js';
import {
  productLookupEmpty,
  productLookupFound,
  productLookupTruncated,
  type LookupScope,
} from '../templates.js';
import { EXAMPLE_QUESTIONS, MAX_ROWS, type ProductSummary } from '../types.js';
import type { ProductLookupIntent } from '../intentSchema.js';

export async function handleProductLookup(
  intent: ProductLookupIntent,
  deps: ChatHandlerDeps,
): Promise<HandlerOutcome> {
  const term = normaliseSlot(intent.productQuery);
  const spokenCategory = normaliseSlot(intent.categoryName);

  // A category name is an ID lookup, not a text search — but only if it really
  // is a category here. If it isn't, we fall back to searching for the phrase,
  // because "laptops" is a category to one tenant and a name fragment to the next.
  const categoryId =
    spokenCategory === undefined ? undefined : await resolveCategoryId(spokenCategory);
  const searchTerm = term ?? (categoryId === undefined ? spokenCategory : undefined);

  let listed = await deps.products.list(
    productsQuery({ limit: MAX_ROWS, search: searchTerm, categoryId }),
  );

  // Zero rows on a plural noun is overwhelmingly a slot-extraction artifact
  // ("laptops" vs a stored "Laptop"), so try the singular ONCE before reporting
  // an empty catalogue — which is what the user would otherwise read it as.
  let effectiveTerm = searchTerm;
  if (listed.totalItems === 0 && searchTerm !== undefined) {
    const singular = singularise(searchTerm);
    if (singular !== undefined) {
      const retry = await deps.products.list(
        productsQuery({ limit: MAX_ROWS, search: singular, categoryId }),
      );
      if (retry.totalItems > 0) {
        listed = retry;
        effectiveTerm = singular;
      }
    }
  }

  const products: ProductSummary[] = toProductSummaries(listed.data, listed.categoryNames);
  const totalCount = listed.totalItems;
  const scope: LookupScope =
    effectiveTerm !== undefined
      ? { kind: 'term', value: effectiveTerm }
      : categoryId !== undefined && spokenCategory !== undefined
        ? { kind: 'category', value: spokenCategory }
        : { kind: 'all' };

  if (totalCount === 0) {
    return {
      result: {
        intent: 'product_lookup',
        summary: productLookupEmpty(scope),
        products: [],
        totalCount: 0,
        examples: [...EXAMPLE_QUESTIONS],
      },
      fallback: fallback('NO_RESULTS'),
      resultCount: 0,
    };
  }

  if (totalCount > products.length) {
    return {
      result: {
        intent: 'product_lookup',
        summary: productLookupTruncated({ scope, totalCount, shown: products.length }),
        products,
        totalCount,
        examples: [],
      },
      fallback: fallback('TOO_MANY_RESULTS'),
      resultCount: products.length,
    };
  }

  // Every match is on screen, so the quantities on screen ARE the total —
  // stating a sum we didn't fully fetch would be exactly the kind of confidently
  // wrong number this design exists to prevent.
  return {
    result: {
      intent: 'product_lookup',
      summary: productLookupFound({ scope, totalCount, totalOnHand: totalOnHand(products) }),
      products,
      totalCount,
      examples: [],
    },
    fallback: null,
    resultCount: products.length,
  };
}
