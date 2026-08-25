/**
 * The eval harness as a DETERMINISTIC contract test (the CI-safe half).
 *
 * Run against the fake provider it proves three things that must never rot:
 *   - every expected classification is itself schema-valid (a case the parser
 *     would reject is a case that can never pass, however good the model gets);
 *   - the eval set is disjoint from the prompt's few-shot examples;
 *   - the scorer counts intents and slots separately and correctly, including
 *     the "right slot string, wrong intent" trap.
 *
 * The LIVE-provider run is `npm run eval:live` — deliberately NOT in the CI
 * gate. Real-LLM runs are non-deterministic and quota-dependent, and gating
 * merges on them makes builds flaky for reasons unrelated to the change.
 */
import { describe, expect, it } from 'vitest';

import { FEW_SHOT_QUESTIONS, PROMPT_VERSION } from '../../src/services/chat/intentPrompt.js';
import { intentSchema, type Intent } from '../../src/services/chat/intentSchema.js';
import { EVAL_CASES, EVAL_THRESHOLDS } from './cases.js';
import { formatReport, runEval } from './score.js';

/** A perfect classifier — replays each case's own expected answer. */
function perfectClassifier(): (question: string) => Promise<Intent> {
  const byQuestion = new Map(
    EVAL_CASES.map((c) => [
      c.question,
      intentSchema.parse({ intent: c.intent, ...(c.slots ?? {}) }),
    ]),
  );
  return (question) => {
    const intent = byQuestion.get(question);
    if (intent === undefined) throw new Error(`no scripted answer for: ${question}`);
    return Promise.resolve(intent);
  };
}

describe('the eval set itself', () => {
  it('has enough cases across all four intents to mean anything', () => {
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(40);
    for (const intent of ['product_lookup', 'low_stock', 'movement_history', 'unsupported']) {
      expect(EVAL_CASES.filter((c) => c.intent === intent).length).toBeGreaterThanOrEqual(8);
    }
  });

  it('is DISJOINT from the prompt few-shot examples', () => {
    const fewShot = new Set(FEW_SHOT_QUESTIONS.map((q) => q.toLowerCase()));
    for (const testCase of EVAL_CASES) {
      expect(fewShot.has(testCase.question.toLowerCase())).toBe(false);
    }
  });

  it('has unique ids and unique questions', () => {
    expect(new Set(EVAL_CASES.map((c) => c.id)).size).toBe(EVAL_CASES.length);
    expect(new Set(EVAL_CASES.map((c) => c.question)).size).toBe(EVAL_CASES.length);
  });

  it('every expected classification parses — an unreachable case is a dead case', () => {
    for (const testCase of EVAL_CASES) {
      const parsed = intentSchema.safeParse({ intent: testCase.intent, ...(testCase.slots ?? {}) });
      expect(parsed.success, `${testCase.id} is not schema-valid`).toBe(true);
    }
  });

  it('scores a perfect classifier at 100% on both axes', async () => {
    const report = await runEval(perfectClassifier(), EVAL_CASES);

    expect(report.intentScore).toBe(1);
    expect(report.slotScore).toBe(1);
    expect(report.failures).toHaveLength(0);
    expect(report.slotCases).toBeGreaterThan(0);
    expect(formatReport(report, PROMPT_VERSION, 'fake')).toContain('intent: 100.0%');
  });
});

describe('the scorer', () => {
  it('keeps intent and slot scores INDEPENDENT', async () => {
    // Always answers low_stock: every non-low_stock intent is wrong, and every
    // slot-bearing case is wrong too.
    const report = await runEval(
      () => Promise.resolve({ intent: 'low_stock', limit: 10 }),
      EVAL_CASES,
    );

    const lowStockCases = EVAL_CASES.filter((c) => c.intent === 'low_stock').length;
    expect(report.intentScore).toBeCloseTo(lowStockCases / EVAL_CASES.length, 5);
    expect(report.slotScore).toBeLessThan(0.2);
  });

  it('does NOT credit a matching slot under the wrong intent', async () => {
    const cases = [
      {
        id: 'X-01',
        question: 'q',
        intent: 'movement_history' as const,
        slots: { productQuery: 'Dell' },
      },
    ];
    const report = await runEval(
      () => Promise.resolve({ intent: 'product_lookup', productQuery: 'Dell' }),
      cases,
    );

    expect(report.intentScore).toBe(0);
    expect(report.slotScore).toBe(0); // the string matched; the classification did not
  });

  it('excludes slot-free cases from the slot denominator', async () => {
    const report = await runEval(perfectClassifier(), EVAL_CASES);
    expect(report.slotCases).toBe(EVAL_CASES.filter((c) => c.slots !== undefined).length);
  });

  it('records a provider failure as a failed case rather than throwing', async () => {
    const report = await runEval(
      () => Promise.reject(new Error('provider down')),
      EVAL_CASES.slice(0, 3),
    );
    expect(report.intentScore).toBe(0);
    expect(report.failures).toHaveLength(3);
  });
});

describe('the shipping gate', () => {
  it('states thresholds that a live run must clear, recorded against a prompt version', () => {
    // Intent ≥ 90% and slot ≥ 75% on the LIVE provider before shipping. Slot is
    // the lower bar on purpose — it is the harder problem, and pretending
    // otherwise produces a gate nobody can pass and everybody disables.
    expect(EVAL_THRESHOLDS.intent).toBe(0.9);
    expect(EVAL_THRESHOLDS.slot).toBe(0.75);
    expect(PROMPT_VERSION).toBeTruthy();
  });
});
