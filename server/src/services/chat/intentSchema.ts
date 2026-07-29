/**
 * THE contract between the model and the server (AI Inventory Assistant, step 1).
 *
 * This is the only place the model's output shape is defined. Everything the
 * model emits is validated here BEFORE any of it is allowed near a query — and
 * nothing the model emits ever reaches Mongo directly: validated slot values are
 * copied into hand-written filters by the handlers.
 *
 * Two properties are load-bearing:
 *
 *  1. **strictObject** — an invented slot (`sortBy`, `limit` on an intent that
 *     has none) is a VALIDATION FAILURE, not a silently ignored key. That turns
 *     "the model drifted" from an invisible behaviour change into fallback
 *     `SCHEMA_VALIDATION_FAILED`, which is logged and counted.
 *  2. **Bounded slot values** — `min(2)` is not cosmetic: a one-character
 *     `productQuery` becomes an unanchored regex that matches nearly the whole
 *     catalogue. `max(60)` caps what can reach that regex at all.
 *
 * There is deliberately NO `confidence` field. Self-reported LLM confidence is
 * uncalibrated (0.95 on wrong answers, 0.6 on right ones), so any threshold on
 * it produces false accepts and false rejects in roughly equal measure while
 * feeling principled. Accuracy is measured by the eval set instead. Omitting it
 * from the schema is stronger than having it and promising not to branch on it —
 * and it removes the envelope object entirely, so the model returns the intent
 * directly.
 */
import { z } from 'zod';

/** Slot values are the ONLY model output that reaches a query. Bound them here. */
const productQuery = z.string().trim().min(2).max(60);

const categoryName = z.string().trim().min(2).max(60);

/**
 * The model does NOT compute dates — it picks a bucket and the SERVER resolves
 * it against the server clock. Models have no reliable "today" and do date
 * arithmetic badly; a hallucinated ISO range is a silently wrong answer.
 */
export const PERIODS = ['last_7_days', 'last_30_days', 'this_month', 'all'] as const;
export type Period = (typeof PERIODS)[number];

const period = z.enum(PERIODS).default('last_30_days');

export const intentSchema = z.discriminatedUnion('intent', [
  /** "How many laptops are available?" and "Show me inventory of Dell laptops"
   *  are the SAME query with different phrasing — one intent, not two. */
  z.strictObject({
    intent: z.literal('product_lookup'),
    productQuery: productQuery.optional(),
    categoryName: categoryName.optional(),
  }),

  z.strictObject({
    intent: z.literal('low_stock'),
    limit: z.number().int().min(1).max(50).default(10),
  }),

  z.strictObject({
    intent: z.literal('movement_history'),
    productQuery: productQuery.optional(),
    period,
    limit: z.number().int().min(1).max(50).default(20),
  }),

  /** A first-class intent, not an error path. "What's the weather?" and "Delete
   *  all products" both land here, and listing it explicitly in the prompt
   *  measurably improves classification of the other three. */
  z.strictObject({ intent: z.literal('unsupported') }),
]);

export type Intent = z.infer<typeof intentSchema>;
export type IntentName = Intent['intent'];

export type ProductLookupIntent = Extract<Intent, { intent: 'product_lookup' }>;
export type LowStockIntent = Extract<Intent, { intent: 'low_stock' }>;
export type MovementHistoryIntent = Extract<Intent, { intent: 'movement_history' }>;

/**
 * Intent names + their slot keys, DERIVED from the schema above so the prompt
 * (which is generated from this) cannot drift from what the parser accepts.
 * A unit test asserts every name here appears in the rendered prompt.
 */
export const INTENT_SHAPES: readonly { intent: IntentName; slots: readonly string[] }[] =
  intentSchema.options.map((option) => ({
    intent: option.shape.intent.value as IntentName,
    slots: Object.keys(option.shape).filter((key) => key !== 'intent'),
  }));

export const INTENT_NAMES: readonly IntentName[] = INTENT_SHAPES.map((s) => s.intent);

/**
 * JSON Schema for providers with constrained decoding. `io: 'input'` matters —
 * fields carrying a `.default()` must be OPTIONAL in what the model produces
 * (the default is applied by us, on parse), not required of it.
 */
export const intentJsonSchema: unknown = z.toJSONSchema(intentSchema, { io: 'input' });
