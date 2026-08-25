/**
 * The chat wire contract — a DISCRIMINATED UNION on `intent`, not
 * `{ summary, rows: unknown[] }`.
 *
 * Untyped rows would mean no OpenAPI contract, no generated client types, and
 * per-intent rendering guesswork in the UI. The row shapes are the EXISTING
 * product/transaction serializer outputs verbatim, so the client reuses its
 * generated types and its product table components rather than growing a second
 * product shape — and money stays a 2-dp string all the way to the screen.
 */
import type { ProductRowPayload } from '../../serializers/product.js';
import type { TransactionRowPayload } from '../../serializers/transaction.js';
import type { Capability } from '../../config/permissionMatrix.js';
import type { IntentName } from './intentSchema.js';

export type ProductSummary = ProductRowPayload;
export type MovementSummary = TransactionRowPayload;

/** Rows shown inline before we stop and ask the user to narrow down. */
export const MAX_ROWS = 10;

/** Candidates offered when a history question matches several products. */
export const MAX_CANDIDATES = 5;

interface ChatResultBase {
  summary: string;
  /**
   * Clickable rephrase suggestions. Zero-result, too-many-result and
   * `unsupported` replies all carry a recovery path — that is what turns a dead
   * end into a rephrase, and rephrases are the signal that decides intent #5.
   */
  examples: string[];
}

export interface ProductLookupResult extends ChatResultBase {
  intent: 'product_lookup';
  products: ProductSummary[];
  /** Total MATCHES, not rows returned — `products.length` is capped at MAX_ROWS. */
  totalCount: number;
}

export interface LowStockResult extends ChatResultBase {
  intent: 'low_stock';
  /** quantity > 0 AND quantity <= lowStockThreshold */
  low: ProductSummary[];
  /** quantity === 0 — reported SEPARATELY because it is strictly more urgent
   *  and burying it inside one number loses that. */
  out: ProductSummary[];
}

export interface MovementHistoryResult extends ChatResultBase {
  intent: 'movement_history';
  product: ProductSummary;
  movements: MovementSummary[];
  totalCount: number;
}

export interface UnsupportedResult extends ChatResultBase {
  intent: 'unsupported';
  capabilities: string[];
}

/** SLOT_MISSING and AMBIGUOUS_PRODUCT — a question back, not an answer. */
export interface ClarifyResult extends ChatResultBase {
  intent: 'clarify';
  candidates: ProductSummary[];
}

export type ChatResult =
  ProductLookupResult | LowStockResult | MovementHistoryResult | UnsupportedResult | ClarifyResult;

/**
 * Intent → capability. Both Phase-1 capabilities are STAFF-accessible, so today
 * there is no role-visible difference — but the check is wired from the start so
 * a narrower intent (#5: supplier spend, say) does not require retrofitting
 * authorization onto a shipped surface.
 */
export const INTENT_CAPABILITY: Record<IntentName, Capability | null> = {
  product_lookup: 'products.view',
  low_stock: 'products.view',
  movement_history: 'transactions.view',
  unsupported: null,
};

/** Rendered into the `unsupported` reply — what this assistant can actually do. */
export const CAPABILITY_BLURBS: readonly string[] = [
  'finding products and their stock levels',
  "what's below reorder level",
  'stock movement history for a product',
];

/** Recovery paths. Deliberately concrete: an abstract hint is not a rephrase. */
export const EXAMPLE_QUESTIONS: readonly string[] = [
  'How many laptops do we have?',
  'Which products are below reorder level?',
  'Show the stock movement history for the last 7 days',
];
