/**
 * Eval scoring — INTENT and SLOT scored SEPARATELY, deliberately.
 *
 * Choosing among four intents looks ~95% accurate almost immediately, while
 * slot extraction is where this class of system actually fails. A single
 * headline number averages the two and hides exactly the half that is broken,
 * so there is no combined score here at all — not even as a convenience.
 */
import type { Intent } from '../../src/services/chat/intentSchema.js';
import type { EvalCase } from './cases.js';

export interface CaseOutcome {
  id: string;
  question: string;
  intentOk: boolean;
  /** `null` when the case states no slots — excluded from the slot score. */
  slotOk: boolean | null;
  expected: { intent: string; slots?: Record<string, string | number> };
  actual: Intent | { error: string };
}

export interface EvalReport {
  intentScore: number;
  slotScore: number;
  /** Cases that stated at least one slot — the slot score's denominator. */
  slotCases: number;
  total: number;
  outcomes: CaseOutcome[];
  failures: CaseOutcome[];
}

/** Case- and whitespace-insensitive; a trailing plural is NOT forgiven, because
 *  the handler's singular retry is a safety net and should not be scored as if
 *  the extraction had been right. */
function sameSlot(expected: string | number, actual: unknown): boolean {
  if (typeof expected === 'number') return actual === expected;
  if (typeof actual !== 'string') return false;
  return actual.trim().toLowerCase() === expected.trim().toLowerCase();
}

export async function runEval(
  classify: (question: string) => Promise<Intent>,
  cases: readonly EvalCase[],
): Promise<EvalReport> {
  const outcomes: CaseOutcome[] = [];

  for (const testCase of cases) {
    let actual: Intent | { error: string };
    try {
      actual = await classify(testCase.question);
    } catch (error) {
      actual = { error: (error as Error).message };
    }

    const intentOk = 'intent' in actual && actual.intent === testCase.intent;
    let slotOk: boolean | null = null;

    if (testCase.slots !== undefined) {
      // A wrong intent is automatically a slot failure — reporting the slot as
      // "correct" because the string happened to match would flatter a
      // classification that never reached the right handler.
      slotOk =
        intentOk &&
        Object.entries(testCase.slots).every(([key, value]) =>
          sameSlot(value, (actual as Record<string, unknown>)[key]),
        );
    }

    outcomes.push({
      id: testCase.id,
      question: testCase.question,
      intentOk,
      slotOk,
      expected:
        testCase.slots === undefined
          ? { intent: testCase.intent }
          : { intent: testCase.intent, slots: testCase.slots },
      actual,
    });
  }

  const slotScored = outcomes.filter((o) => o.slotOk !== null);
  return {
    intentScore: outcomes.filter((o) => o.intentOk).length / outcomes.length,
    slotScore:
      slotScored.length === 0 ? 1 : slotScored.filter((o) => o.slotOk).length / slotScored.length,
    slotCases: slotScored.length,
    total: outcomes.length,
    outcomes,
    failures: outcomes.filter((o) => !o.intentOk || o.slotOk === false),
  };
}

export function formatReport(report: EvalReport, promptVersion: string, label: string): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const lines = [
    `eval — ${label} · prompt ${promptVersion}`,
    `  intent: ${pct(report.intentScore)} (${report.total} cases)`,
    `  slot:   ${pct(report.slotScore)} (${String(report.slotCases)} cases stating slots)`,
  ];
  if (report.failures.length > 0) {
    lines.push('  failures:');
    for (const failure of report.failures) {
      lines.push(
        `    ${failure.id} ${failure.intentOk ? 'slot' : 'intent'} — "${failure.question}"`,
        `      expected ${JSON.stringify(failure.expected)}`,
        `      actual   ${JSON.stringify(failure.actual)}`,
      );
    }
  }
  return lines.join('\n');
}
