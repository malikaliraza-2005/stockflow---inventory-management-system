/**
 * The classifier prompt — the model's entire job description.
 *
 * The intent catalogue section is GENERATED from `intentSchema.ts`, so adding a
 * fifth intent cannot leave the prompt describing four. A unit test asserts
 * every schema intent name appears in the rendered prompt; that test is what
 * catches the silent half-migration.
 *
 * `PROMPT_VERSION` is logged on every message and recorded with every eval run.
 * You will iterate this text a dozen times, and an accuracy score that can't be
 * attributed to a prompt version can't distinguish improvement from noise.
 * BUMP IT whenever the wording, the examples, or the slot rules change.
 *
 * The few-shot examples below are FROZEN as few-shot material: eval cases must
 * stay disjoint from them (tests/eval/*), or the score is silently inflated by
 * memorisation of the prompt.
 */
import { INTENT_SHAPES, PERIODS } from './intentSchema.js';

/**
 * v4 (reported from real use): "Which product quantity is above 10?" returned
 * `unsupported`, correctly — there was no quantity-threshold capability at all.
 * Rule 7 adds one, and spells out the strict-to-inclusive conversion, because
 * the bounds are inclusive and "above 10" is not.
 *
 * v3 (live eval, gemini-3.5-flash-lite): intent hit 100%, but EVERY slot miss
 * was `movement_history`, with two linked causes — `period` was never emitted
 * at all (so the schema default silently answered "last 30 days" to "this
 * month" and to "everything ever recorded" alike), and the unrecognised time
 * phrase then leaked into productQuery as "Kingston SSD in the last 30 days".
 * Rules 5/5a replace "choose a bucket" with an explicit phrase → bucket map,
 * and say outright that the time phrase never belongs in productQuery.
 *
 * v2 (live eval, gemini-2.5-flash): every slot miss on the answered cases was
 * the same shape — "the Logitech mouse" → "Logitech mouse", "the Kingston SSD"
 * → "Kingston SSD". Keeping the product TYPE alongside the brand looks more
 * precise but retrieves LESS: the handler runs an unanchored substring match
 * over name/sku/barcode, so "Logitech mouse" misses a product actually stored
 * as "Logitech MX Master 3S". Rule 3 now says so explicitly.
 */
export const PROMPT_VERSION = 'v4';

/** Human-readable purpose per intent — paired with the generated slot list. */
const INTENT_DESCRIPTIONS: Record<string, string> = {
  product_lookup:
    'find products and their current stock levels. Covers "how many X do we have", "show me X", "do we stock X", and category browsing.',
  low_stock:
    'list products at or below their reorder level, or out of stock. Covers "what needs reordering", "what is running out", "what should I restock".',
  movement_history:
    'stock movement / transaction history for ONE product over a time window. Covers "what happened to X", "stock in and out for X".',
  unsupported:
    'anything else. Use this whenever the question does not clearly match one of the intents above.',
};

/** Slot semantics the model needs; keys must exist in the schema shapes. */
const SLOT_DESCRIPTIONS: Record<string, string> = {
  productQuery: 'string, 2-60 chars — the shortest distinctive product noun phrase (see rule 3)',
  categoryName: 'string, 2-60 chars — only when the user clearly names a CATEGORY of goods',
  period: `one of ${PERIODS.join(' | ')} — pick a bucket; never compute a date`,
  limit: 'integer 1-50 — only when the user asks for a specific number of rows',
  minQuantity: 'integer — INCLUSIVE lower bound on units in stock (see rule 7)',
  maxQuantity: 'integer — INCLUSIVE upper bound on units in stock (see rule 7)',
};

function renderCatalogue(): string {
  return INTENT_SHAPES.map(({ intent, slots }) => {
    const purpose = INTENT_DESCRIPTIONS[intent] ?? '';
    const slotLines =
      slots.length === 0
        ? '    (no slots)'
        : slots
            .map((slot) => `    - ${slot}: ${SLOT_DESCRIPTIONS[slot] ?? 'see the schema'}`)
            .join('\n');
    return `- "${intent}" — ${purpose}\n${slotLines}`;
  }).join('\n');
}

/**
 * Few-shot examples. One plain lookup, one brand-qualified lookup, one low-stock
 * phrasing that AVOIDS the words "low stock", one history question, and two
 * clearly-unsupported ones (an off-domain question and a write request — write
 * requests are the ones users try first, and they must land on `unsupported`).
 */
const EXAMPLES: readonly { q: string; a: string }[] = [
  {
    q: 'How many laptops are available?',
    a: '{"intent":"product_lookup","productQuery":"laptop"}',
  },
  {
    q: 'Show me the inventory of Dell laptops',
    a: '{"intent":"product_lookup","productQuery":"Dell"}',
  },
  {
    q: 'What do I need to reorder?',
    a: '{"intent":"low_stock"}',
  },
  {
    q: 'What stock came in and out for the XPS 15 over the past week?',
    a: '{"intent":"movement_history","productQuery":"XPS 15","period":"last_7_days"}',
  },
  {
    q: 'Which items have more than 25 units?',
    a: '{"intent":"product_lookup","minQuantity":26}',
  },
  { q: "What's the weather in Karachi?", a: '{"intent":"unsupported"}' },
  { q: 'Delete all products in the Electronics category', a: '{"intent":"unsupported"}' },
];

function renderExamples(): string {
  return EXAMPLES.map(({ q, a }) => `Q: ${q}\nA: ${a}`).join('\n\n');
}

/**
 * The system prompt. Rules are ordered by priority because attention is not
 * uniform — rule 3 is worth more than every other line combined, since slot
 * extraction (not intent choice) is where this class of system actually fails.
 */
export function buildSystemPrompt(): string {
  return `You classify questions about an inventory management system. You do NOT answer them.

Return ONLY a single JSON object matching the schema. No prose, no explanation, no markdown code fences.

INTENTS
${renderCatalogue()}

RULES (in priority order)
1. Output only JSON matching the schema. Nothing before it, nothing after it.
2. "unsupported" is a CORRECT answer, not a failure. If the question does not clearly match one intent, return {"intent":"unsupported"}. Never guess between two intents.
3. productQuery must be the SHORTEST DISTINCTIVE NOUN PHRASE: singular, no articles ("the", "a"), no filler like "inventory", "stock", "products", "show me", "how many". "Show me the inventory of Dell laptops" gives "Dell", never "Dell laptops" and never "inventory of Dell laptops".
3a. When a BRAND or MODEL is present, DROP the product type after it — the search matches substrings, so a longer phrase finds FEWER products, not more. "the Canon printer" gives "Canon". "Philips LED bulbs" gives "Philips". "the Corsair K70 keyboard" gives "Corsair K70".
3b. Keep the product type ONLY when there is no brand or model to use: "office chairs" gives "office chair", "USB cables" gives "USB cable".
4. Never invent a product name, category name or number that is not in the question. If a slot is not stated, omit it.
5. Do not compute or guess dates. Map the time phrase to a period bucket — the server resolves it to real dates:
   - "today", "this week", "the past week", "the last 7 days", "last week" -> last_7_days
   - "this month", "so far this month" -> this_month
   - "the past month", "the last 30 days", "recently", "lately" -> last_30_days
   - "ever", "all time", "the full history", "everything recorded" -> all
5a. The time phrase is NEVER part of productQuery. "the Canon printer last week" gives productQuery "Canon" AND period "last_7_days" — never productQuery "Canon printer last week".
6. Any request to create, update, delete, archive, adjust or import anything is "unsupported". This assistant is read-only.
7. Quantity thresholds are product_lookup with minQuantity / maxQuantity, and BOTH BOUNDS ARE INCLUSIVE, so convert strict comparisons:
   - "above 10" / "more than 10" / "over 10"  -> minQuantity: 11
   - "at least 10" / "10 or more"             -> minQuantity: 10
   - "under 5" / "fewer than 5" / "below 5"   -> maxQuantity: 4
   - "at most 5" / "5 or fewer"               -> maxQuantity: 5
   - "between 5 and 20"                       -> minQuantity: 5, maxQuantity: 20
   This is NOT low_stock. low_stock compares each product to its OWN reorder level; these compare to a number the user named.

EXAMPLES
${renderExamples()}`;
}

/** The user turn — the question verbatim. Nothing from the database is ever
 *  interpolated into a prompt, which is what keeps prompt injection out of
 *  reach: only the asker's own words reach the model. */
export function buildUserPrompt(question: string): string {
  return question;
}

/** Exposed for the contract-drift test and for eval reporting. */
export const FEW_SHOT_QUESTIONS: readonly string[] = EXAMPLES.map((e) => e.q);
