/**
 * Live-provider eval — `npm run eval:live`. MANUAL or scheduled, never a CI gate.
 *
 * Real-LLM runs are non-deterministic and quota-dependent; gating merges on one
 * makes builds flaky for reasons that have nothing to do with the change under
 * review. Run this when the prompt changes, record both scores against
 * PROMPT_VERSION, and compare to the previous baseline — a score you cannot
 * attribute to a prompt version cannot distinguish improvement from noise.
 *
 * Reads LLM_PROVIDER / LLM_MODEL / LLM_API_KEY from the environment. Exits
 * non-zero if either threshold is missed, so it is usable from a cron job.
 */
import { loadEnv } from '../../src/config/env.js';
import { PROMPT_VERSION } from '../../src/services/chat/intentPrompt.js';
import { ChatService } from '../../src/services/ChatService.js';
import { createLlmProvider } from '../../src/services/llm/providers/index.js';
import type { ProductService } from '../../src/services/ProductService.js';
import type { TransactionService } from '../../src/services/TransactionService.js';
import { EVAL_CASES, EVAL_THRESHOLDS } from './cases.js';
import { formatReport, runEval } from './score.js';

const env = loadEnv();
if (env.LLM_PROVIDER === 'fake') {
  console.error('eval:live needs a real LLM_PROVIDER (set LLM_PROVIDER=gemini and LLM_API_KEY).');
  process.exit(2);
}

const service = new ChatService({
  llm: createLlmProvider(env),
  // Only `classify()` is exercised here — no handler runs, so no database is
  // touched and no tenant context is needed.
  products: undefined as unknown as ProductService,
  transactions: undefined as unknown as TransactionService,
  config: { maxTokens: env.LLM_MAX_TOKENS, timeoutMs: env.LLM_TIMEOUT_MS },
});

// ~10 requests/minute on the free tier. Overriding this downward on a paid key
// is the whole reason it is an env var and not a constant.
const delayMs = Number(process.env['EVAL_DELAY_MS'] ?? 7_000);
/** EVAL_LIMIT trims the run — a smoke check that costs 5 requests instead of 42
 *  while diagnosing configuration or quota. Never use a trimmed run as a score. */
const limit = Number(process.env['EVAL_LIMIT'] ?? EVAL_CASES.length);
const cases = EVAL_CASES.slice(0, limit);

console.log(
  `running ${String(cases.length)} of ${String(EVAL_CASES.length)} cases at ` +
    `${String(delayMs)}ms spacing (~${String(Math.ceil((cases.length * delayMs) / 60_000))} min)…`,
);
if (cases.length < EVAL_CASES.length) {
  console.log('NOTE: trimmed run — diagnostic only, not a score.');
}

const report = await runEval(async (question) => (await service.classify(question)).intent, cases, {
  delayMs,
});

console.log(formatReport(report, PROMPT_VERSION, `${env.LLM_PROVIDER}/${env.LLM_MODEL}`));

if (report.errored > 0) {
  // An incomplete run cannot pass OR fail — it measured nothing. Saying "FAIL"
  // here would send someone off to tune prompt wording to fix a quota problem.
  console.log('\nINCOMPLETE — no score recorded. Re-run once the provider answers every case.');
  process.exit(2);
}

const passed =
  report.intentScore >= EVAL_THRESHOLDS.intent && report.slotScore >= EVAL_THRESHOLDS.slot;
console.log(
  passed
    ? '\nPASS — both thresholds cleared.'
    : `\nFAIL — need intent ≥ ${String(EVAL_THRESHOLDS.intent * 100)}% and slot ≥ ${String(
        EVAL_THRESHOLDS.slot * 100,
      )}%.`,
);
process.exit(passed ? 0 : 1);
