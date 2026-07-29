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

const report = await runEval(
  async (question) => (await service.classify(question)).intent,
  EVAL_CASES,
);

console.log(formatReport(report, PROMPT_VERSION, `${env.LLM_PROVIDER}/${env.LLM_MODEL}`));

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
