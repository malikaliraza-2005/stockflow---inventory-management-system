/**
 * Provider selection + failover — "when this account's tokens are empty, use
 * the other one".
 *
 * The behaviour that matters is not that failover HAPPENS, but exactly WHEN:
 * on exhaustion (quota, credit, key) and on nothing else. Failing over on a
 * timeout would spend the backup's quota to route around a blip, which on a
 * free tier is the expensive mistake.
 */
import { describe, expect, it, vi } from 'vitest';

import { makeFailoverProvider } from '../../src/services/llm/providers/failover.js';
import {
  createLlmProvider,
  DEFAULT_MODELS,
  LLM_PROVIDERS,
} from '../../src/services/llm/providers/index.js';
import { LlmProviderError, type LlmProvider } from '../../src/services/llm/types.js';

const req = {
  system: 'sys',
  user: 'how many laptops?',
  maxTokens: 256,
  temperature: 0,
  signal: AbortSignal.timeout(1_000),
};

function stub(id: string, behaviour: () => Promise<{ text: string }>): LlmProvider {
  return {
    id,
    model: `${id}-model`,
    complete: vi.fn(async () => {
      const { text } = await behaviour();
      return { text, inputTokens: 1, outputTokens: 1 };
    }),
  };
}

const ok = (text: string) => () => Promise.resolve({ text });
const fails = (error: Error) => () => Promise.reject(error);
const exhausted = (status: number) =>
  fails(
    new LlmProviderError(`spent ${String(status)}`, { retryable: false, status, exhausted: true }),
  );

describe('failover chain', () => {
  it('uses the primary while it works, and never touches the backup', async () => {
    const backup = stub('grok', ok('{"intent":"low_stock"}'));
    const provider = makeFailoverProvider({
      providers: [stub('gemini', ok('{"intent":"product_lookup"}')), backup],
    });

    const res = await provider.complete(req);

    expect(res.text).toBe('{"intent":"product_lookup"}');
    expect(backup.complete).not.toHaveBeenCalled();
  });

  it('switches to the backup when the primary is EXHAUSTED', async () => {
    const provider = makeFailoverProvider({
      providers: [stub('gemini', exhausted(429)), stub('grok', ok('{"intent":"low_stock"}'))],
    });

    const res = await provider.complete(req);

    expect(res.text).toBe('{"intent":"low_stock"}');
    // And reports the ACTIVE provider, so the log record names who answered.
    expect(provider.id).toBe('grok');
    expect(provider.model).toBe('grok-model');
  });

  it.each([401, 402, 403, 429])('treats %i as exhaustion', async (status) => {
    const provider = makeFailoverProvider({
      providers: [stub('gemini', exhausted(status)), stub('grok', ok('{"intent":"low_stock"}'))],
    });
    await expect(provider.complete(req)).resolves.toMatchObject({ text: '{"intent":"low_stock"}' });
  });

  it('does NOT fail over on a timeout — transient, and the retry already covers it', async () => {
    const backup = stub('grok', ok('{"intent":"low_stock"}'));
    const provider = makeFailoverProvider({
      providers: [
        stub('gemini', fails(new LlmProviderError('timed out', { retryable: false }))),
        backup,
      ],
    });

    await expect(provider.complete(req)).rejects.toThrow(/timed out/);
    expect(backup.complete).not.toHaveBeenCalled();
  });

  it('does NOT fail over on a 5xx — a blip is not an empty account', async () => {
    const backup = stub('grok', ok('{"intent":"low_stock"}'));
    const provider = makeFailoverProvider({
      providers: [
        stub(
          'gemini',
          fails(new LlmProviderError('upstream 503', { retryable: true, status: 503 })),
        ),
        backup,
      ],
    });

    await expect(provider.complete(req)).rejects.toThrow(/503/);
    expect(backup.complete).not.toHaveBeenCalled();
  });

  it('remembers exhaustion — the spent provider is not retried on later messages', async () => {
    const primary = stub('gemini', exhausted(429));
    const provider = makeFailoverProvider({
      providers: [primary, stub('grok', ok('{"intent":"low_stock"}'))],
    });

    await provider.complete(req);
    await provider.complete(req);
    await provider.complete(req);

    // Probed once, then skipped: re-checking a spent daily quota would add a
    // guaranteed-failing round trip to every message for hours.
    expect(primary.complete).toHaveBeenCalledTimes(1);
  });

  it('surfaces a real provider error when EVERY provider is spent', async () => {
    const provider = makeFailoverProvider({
      providers: [stub('gemini', exhausted(429)), stub('grok', exhausted(402))],
    });

    await expect(provider.complete(req)).rejects.toBeInstanceOf(LlmProviderError);
    // Still a provider error, so ChatService still renders a clean 503.
    await expect(provider.complete(req)).rejects.toThrow(/spent/);
  });

  it('logs the switch — a silent failover hides that the primary died', async () => {
    const warn = vi.fn();
    const provider = makeFailoverProvider({
      providers: [stub('gemini', exhausted(429)), stub('grok', ok('{"intent":"low_stock"}'))],
      logger: { warn },
    });

    await provider.complete(req);

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'gemini', status: 429 }),
      expect.stringContaining('exhausted'),
    );
  });

  it('returns the single provider unwrapped rather than a chain of one', () => {
    const only = stub('gemini', ok('{}'));
    expect(makeFailoverProvider({ providers: [only] })).toBe(only);
  });
});

describe('createLlmProvider', () => {
  it('every provider id has a default model — switching must not require one', () => {
    for (const id of LLM_PROVIDERS) {
      expect(DEFAULT_MODELS[id]).toBeTruthy();
    }
  });

  it('selects the named provider and applies its default model', () => {
    expect(createLlmProvider({ LLM_PROVIDER: 'gemini' })).toMatchObject({
      id: 'gemini',
      model: DEFAULT_MODELS.gemini,
    });
    expect(createLlmProvider({ LLM_PROVIDER: 'groq' })).toMatchObject({
      id: 'groq',
      model: DEFAULT_MODELS.groq,
    });
    // Groq and Grok are different vendors one letter apart — both registered.
    expect(createLlmProvider({ LLM_PROVIDER: 'grok' })).toMatchObject({
      id: 'grok',
      model: DEFAULT_MODELS.grok,
    });
  });

  it('LLM_MODEL overrides the primary only', () => {
    const provider = createLlmProvider({
      LLM_PROVIDER: 'gemini',
      LLM_MODEL: 'gemini-2.0-flash',
      LLM_FALLBACK_PROVIDER: 'grok',
      LLM_FALLBACK_API_KEY: 'k',
    });
    // A chain across two vendors cannot share one model name.
    expect(provider.model).toBe('gemini-2.0-flash');
  });

  it('builds a chain only when a DIFFERENT fallback is named', () => {
    const single = createLlmProvider({ LLM_PROVIDER: 'gemini', LLM_FALLBACK_PROVIDER: 'gemini' });
    expect(single.id).toBe('gemini');

    const chained = createLlmProvider({
      LLM_PROVIDER: 'gemini',
      LLM_FALLBACK_PROVIDER: 'grok',
      LLM_FALLBACK_API_KEY: 'k',
    });
    expect(chained.id).toBe('gemini'); // primary is healthy, so it fronts the chain
  });
});
