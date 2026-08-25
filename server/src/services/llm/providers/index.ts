/**
 * Provider selection — still a `switch`, not a registry.
 *
 * A registry (id → factory map, dynamic import, plugin discovery) is what you
 * build when providers arrive from outside the codebase. Here there are three,
 * all in this folder, and a fourth is one more arm.
 *
 * `LLM_FALLBACK_PROVIDER` composes two of them into a failover chain, so a
 * spent free-tier quota switches accounts instead of taking the assistant down.
 */
import { makeStubProvider } from './fake.js';
import { makeFailoverProvider } from './failover.js';
import { makeGeminiProvider } from './gemini.js';
import { makeGrokProvider, makeGroqProvider } from './openaiCompatible.js';
import type { Logger } from '../../../lib/logger.js';
import type { LlmProvider } from '../types.js';

export const LLM_PROVIDERS = ['fake', 'gemini', 'groq', 'grok'] as const;
export type LlmProviderId = (typeof LLM_PROVIDERS)[number];

/**
 * Per-provider default model, so switching provider does not also require
 * knowing that vendor's model naming. `LLM_MODEL` overrides — but note it
 * applies to the PRIMARY only: a chain across two vendors cannot share one
 * model name, and silently sending a Gemini id to xAI would fail confusingly.
 */
export const DEFAULT_MODELS: Record<LlmProviderId, string> = {
  fake: 'stub-unsupported',
  // Verified working on the free tier, and cheap: ~13 output tokens per
  // classification. NOT gemini-2.5-flash — it reasons before answering and
  // those thought tokens are billed against maxOutputTokens (see gemini.ts).
  gemini: 'gemini-3.5-flash-lite',
  // Groq (console.groq.com) — an inference provider for open models. Big free
  // tier, and 70B is worth it over 8B here: intent choice is easy but SLOT
  // extraction is where this design actually fails, and that is where a larger
  // model earns its latency.
  groq: 'llama-3.3-70b-versatile',
  // Grok (console.x.ai) — xAI's own models. Note the one-letter difference.
  grok: 'grok-4-fast-non-reasoning',
};

export interface LlmConfig {
  LLM_PROVIDER: LlmProviderId;
  /** Applies to the PRIMARY provider only; absent ⇒ that provider's default. */
  LLM_MODEL?: string | undefined;
  LLM_API_KEY?: string | undefined;
  /** Optional second provider, used only when the primary reports exhaustion. */
  LLM_FALLBACK_PROVIDER?: LlmProviderId | undefined;
  LLM_FALLBACK_API_KEY?: string | undefined;
  LLM_FALLBACK_MODEL?: string | undefined;
}

function makeOne(id: LlmProviderId, apiKey: string, model: string): LlmProvider {
  switch (id) {
    case 'gemini':
      return makeGeminiProvider({ apiKey, model });
    case 'groq':
      return makeGroqProvider({ apiKey, model });
    case 'grok':
      return makeGrokProvider({ apiKey, model });
    case 'fake':
      // Dev/test default. Answers `unsupported` to everything, which is a
      // truthful "not configured" rather than a plausible fabrication.
      return makeStubProvider();
  }
}

export function createLlmProvider(config: LlmConfig, logger?: Pick<Logger, 'warn'>): LlmProvider {
  const primary = makeOne(
    config.LLM_PROVIDER,
    config.LLM_API_KEY ?? '',
    config.LLM_MODEL ?? DEFAULT_MODELS[config.LLM_PROVIDER],
  );

  const fallbackId = config.LLM_FALLBACK_PROVIDER;
  if (fallbackId === undefined || fallbackId === config.LLM_PROVIDER) return primary;

  const fallback = makeOne(
    fallbackId,
    config.LLM_FALLBACK_API_KEY ?? '',
    config.LLM_FALLBACK_MODEL ?? DEFAULT_MODELS[fallbackId],
  );
  return makeFailoverProvider({ providers: [primary, fallback], logger });
}
