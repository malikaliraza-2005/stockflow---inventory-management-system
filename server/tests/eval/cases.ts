/**
 * The eval set — 42 phrasings with their expected classification.
 *
 * ── Two rules, both load-bearing ──────────────────────────────────────────
 *
 * 1. **Disjoint from the few-shot examples.** Reusing a prompt example as an
 *    eval case measures memorisation and inflates the score silently. A test in
 *    `intents.test.ts` enforces this rather than trusting a convention.
 *
 * 2. **Frozen.** Add cases when an intent is added; NEVER edit an existing case
 *    to make a run pass. An eval you can edit is a thermometer you can hold
 *    against a radiator.
 *
 * `slots` lists only what the question actually STATES. Slots the model may
 * legitimately omit (a period nobody mentioned, a limit nobody asked for) are
 * absent here and are not scored — expecting them would punish correct
 * behaviour. A case with no `slots` key scores intent only.
 */
import type { IntentName } from '../../src/services/chat/intentSchema.js';

export interface EvalCase {
  id: string;
  question: string;
  intent: IntentName;
  /** Slots the question states explicitly. Compared case-insensitively. */
  slots?: Record<string, string | number>;
}

export const EVAL_CASES: readonly EvalCase[] = [
  // ── product_lookup — the merged "how many" / "show me" intent ───────────
  {
    id: 'PL-01',
    question: 'Do we stock HP printers?',
    intent: 'product_lookup',
    slots: { productQuery: 'HP' },
  },
  {
    id: 'PL-02',
    question: 'How much stock is left of the Logitech mouse?',
    intent: 'product_lookup',
    slots: { productQuery: 'Logitech' },
  },
  {
    id: 'PL-03',
    question: 'Show me all keyboards',
    intent: 'product_lookup',
    slots: { productQuery: 'keyboard' },
  },
  {
    id: 'PL-04',
    question: "What's the current inventory for SKU ELEC-00042?",
    intent: 'product_lookup',
    slots: { productQuery: 'ELEC-00042' },
  },
  {
    id: 'PL-05',
    question: 'Are there any Samsung monitors left?',
    intent: 'product_lookup',
    slots: { productQuery: 'Samsung' },
  },
  {
    id: 'PL-06',
    question: 'List everything in the Furniture category',
    intent: 'product_lookup',
    slots: { categoryName: 'Furniture' },
  },
  {
    id: 'PL-07',
    question: 'How many units of the Anker charger do we have?',
    intent: 'product_lookup',
    slots: { productQuery: 'Anker' },
  },
  {
    id: 'PL-08',
    question: 'Check availability of USB cables',
    intent: 'product_lookup',
    slots: { productQuery: 'USB cable' },
  },
  {
    id: 'PL-09',
    question: 'Is the Kingston SSD available?',
    intent: 'product_lookup',
    slots: { productQuery: 'Kingston' },
  },
  {
    id: 'PL-10',
    question: 'What products do we have from Nike?',
    intent: 'product_lookup',
    slots: { productQuery: 'Nike' },
  },
  {
    id: 'PL-11',
    question: 'Show inventory levels for office chairs',
    intent: 'product_lookup',
    slots: { productQuery: 'office chair' },
  },
  {
    id: 'PL-12',
    question: 'Give me the stock count for cables',
    intent: 'product_lookup',
    slots: { productQuery: 'cable' },
  },
  {
    id: 'PL-13',
    question: 'Which items are in the Stationery category?',
    intent: 'product_lookup',
    slots: { categoryName: 'Stationery' },
  },
  {
    id: 'PL-14',
    question: 'Do we carry Bosch drills?',
    intent: 'product_lookup',
    slots: { productQuery: 'Bosch' },
  },

  // ── low_stock — mostly phrasings that AVOID the words "low stock" ───────
  { id: 'LS-01', question: "What's running low?", intent: 'low_stock' },
  { id: 'LS-02', question: 'Which items need restocking?', intent: 'low_stock' },
  { id: 'LS-03', question: 'Show me everything below the reorder point', intent: 'low_stock' },
  { id: 'LS-04', question: 'What am I about to run out of?', intent: 'low_stock' },
  { id: 'LS-05', question: 'Anything out of stock right now?', intent: 'low_stock' },
  { id: 'LS-06', question: 'Give me the reorder list', intent: 'low_stock' },
  { id: 'LS-07', question: 'Which products are low on stock?', intent: 'low_stock' },
  {
    id: 'LS-08',
    question: 'Show me the top 5 items that need reordering',
    intent: 'low_stock',
    slots: { limit: 5 },
  },

  // ── movement_history — the intent with a resolution step ────────────────
  {
    id: 'MH-01',
    question: 'Show the stock movements for the Logitech mouse this month',
    intent: 'movement_history',
    slots: { productQuery: 'Logitech', period: 'this_month' },
  },
  {
    id: 'MH-02',
    question: 'What happened to the Kingston SSD in the last 30 days?',
    intent: 'movement_history',
    slots: { productQuery: 'Kingston', period: 'last_30_days' },
  },
  {
    id: 'MH-03',
    question: 'Stock in and out for office chairs over the past 7 days',
    intent: 'movement_history',
    slots: { productQuery: 'office chair', period: 'last_7_days' },
  },
  {
    id: 'MH-04',
    question: 'Give me the full transaction history for the Anker charger',
    intent: 'movement_history',
    slots: { productQuery: 'Anker', period: 'all' },
  },
  {
    id: 'MH-05',
    question: "How has the Samsung monitor's stock changed recently?",
    intent: 'movement_history',
    slots: { productQuery: 'Samsung' },
  },
  {
    id: 'MH-06',
    question: 'Show all movements ever recorded for SKU ELEC-00042',
    intent: 'movement_history',
    slots: { productQuery: 'ELEC-00042', period: 'all' },
  },
  {
    id: 'MH-07',
    question: 'What adjustments were made to the Bosch drill last week?',
    intent: 'movement_history',
    slots: { productQuery: 'Bosch', period: 'last_7_days' },
  },
  {
    id: 'MH-08',
    question: 'Ledger entries for keyboards this month',
    intent: 'movement_history',
    slots: { productQuery: 'keyboard', period: 'this_month' },
  },
  {
    id: 'MH-09',
    question: 'Show me the last 10 movements for the HP printer',
    intent: 'movement_history',
    slots: { productQuery: 'HP', limit: 10 },
  },
  {
    id: 'MH-10',
    question: 'Stock history for Nike shoes',
    intent: 'movement_history',
    slots: { productQuery: 'Nike' },
  },

  // ── unsupported — writes, compound questions, and off-domain ────────────
  { id: 'UN-01', question: 'Who is the CEO of this company?', intent: 'unsupported' },
  { id: 'UN-02', question: 'Add 50 units of the Anker charger', intent: 'unsupported' },
  { id: 'UN-03', question: 'Change the price of the Kingston SSD to 99.99', intent: 'unsupported' },
  { id: 'UN-04', question: 'Which supplier gives us the best margin?', intent: 'unsupported' },
  { id: 'UN-05', question: 'Translate this page into Urdu', intent: 'unsupported' },
  { id: 'UN-06', question: 'Archive all discontinued products', intent: 'unsupported' },
  { id: 'UN-07', question: 'What was our total revenue last quarter?', intent: 'unsupported' },
  {
    id: 'UN-08',
    question: "Compare this month's movements to last month's",
    intent: 'unsupported',
  },
  { id: 'UN-09', question: 'Export the inventory report as a PDF', intent: 'unsupported' },
  { id: 'UN-10', question: 'Set the reorder level for keyboards to 20', intent: 'unsupported' },
];

/** The gates the design commits to before shipping on a live provider. */
export const EVAL_THRESHOLDS = { intent: 0.9, slot: 0.75 } as const;
