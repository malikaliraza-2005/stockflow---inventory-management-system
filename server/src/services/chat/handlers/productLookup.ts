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
  searchProducts,
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

  // The relaxation ladder does the work here: an exact substring search is
  // exact in a way people are not, so a phrase that finds nothing is retried
  // singular, then word by word, then stemmed (see searchVariants).
  const search =
    searchTerm === undefined
      ? undefined
      : await searchProducts(deps.products, searchTerm, { limit: MAX_ROWS, categoryId });
  const listed =
    search?.listed ?? (await deps.products.list(productsQuery({ limit: MAX_ROWS, categoryId })));

  const products: ProductSummary[] = toProductSummaries(listed.data, listed.categoryNames);
  const totalCount = listed.totalItems;
  const scope: LookupScope =
    search !== undefined
      ? {
          kind: 'term',
          value: search.matched,
          // Only disclosed when the widening actually FOUND something —
          // otherwise the miss message should name what the user asked for.
          ...(search.widened && totalCount > 0 && searchTerm !== undefined
            ? { asked: searchTerm }
            : {}),
        }
      : categoryId !== undefined && spokenCategory !== undefined
        ? { kind: 'category', value: spokenCategory }
        : { kind: 'all' };

  if (totalCount === 0) {
    return {
      result: {
        intent: 'product_lookup',
        // Name what the USER asked for, not the widest variant we tried.
        summary: productLookupEmpty(
          searchTerm === undefined ? scope : { kind: 'term', value: searchTerm },
        ),
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
