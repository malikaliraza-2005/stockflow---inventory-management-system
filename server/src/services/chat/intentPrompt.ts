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
 * v2 (live eval, gemini-2.5-flash): every slot miss on the answered cases was
 * the same shape — "the Logitech mouse" → "Logitech mouse", "the Kingston SSD"
 * → "Kingston SSD". Keeping the product TYPE alongside the brand looks more
 * precise but retrieves LESS: the handler runs an unanchored substring match
 * over name/sku/barcode, so "Logitech mouse" misses a product actually stored
 * as "Logitech MX Master 3S". Rule 3 now says so explicitly.
 */
export const PROMPT_VERSION = 'v2';

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
5. Do not compute or guess dates. Choose a period bucket; the server resolves it.
6. Any request to create, update, delete, archive, adjust or import anything is "unsupported". This assistant is read-only.

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
