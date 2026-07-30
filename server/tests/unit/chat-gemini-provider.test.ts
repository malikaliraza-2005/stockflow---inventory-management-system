/**
 * The one real provider, tested through an injected `fetch` — no network, no
 * key, no quota. What matters here is not the happy path (it is one POST) but
 * the FAILURE CLASSIFICATION, because on a free tier quota exhaustion is the
 * expected failure rather than an edge case, and because retrying the wrong
 * class of error burns the very quota that ran out.
 *
 * Also covered: the JSON-Schema → Gemini-subset transform. Gemini accepts an
 * OpenAPI-3.0 subset, so the zod-generated schema needs a mechanical rewrite —
 * written as a transform rather than a hand-maintained second copy, because a
 * hand-copied schema is exactly what drifts the first time an intent is added.
 */
import { describe, expect, it, vi } from 'vitest';

import { intentJsonSchema } from '../../src/services/chat/intentSchema.js';
import { makeGeminiProvider, toGeminiSchema } from '../../src/services/llm/providers/gemini.js';
import { LlmProviderError } from '../../src/services/llm/types.js';

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function okBody(text: string) {
  return {
    candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 14 },
  };
}

function makeProvider(fetchImpl: typeof fetch) {
  return makeGeminiProvider({ apiKey: 'test-key', model: 'gemini-2.5-flash', fetchImpl });
}

const req = {
  system: 'classify this',
  user: 'how many laptops?',
  json: { schema: intentJsonSchema },
  maxTokens: 256,
  temperature: 0,
  signal: AbortSignal.timeout(5_000),
};

describe('request shaping', () => {
  it('sends the key as a HEADER, constrained JSON output, and the abort signal', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(okBody('{"intent":"low_stock"}')));
    const res = await makeProvider(fetchImpl as unknown as typeof fetch).complete(req);

    expect(res.text).toBe('{"intent":"low_stock"}');
    expect(res.inputTokens).toBe(120);
    expect(res.outputTokens).toBe(14);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit & { signal: AbortSignal }];
    expect(url).toContain('gemini-2.5-flash:generateContent');
    // A key in the query string lands in access logs; a header does not.
    expect(url).not.toContain('test-key');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key');
    expect(init.signal).toBeInstanceOf(AbortSignal);

    const body = JSON.parse(init.body as string) as {
      generationConfig: { temperature: number; responseMimeType: string; responseSchema: unknown };
      system_instruction: { parts: { text: string }[] };
    };
    expect(body.generationConfig.temperature).toBe(0);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.system_instruction.parts[0]?.text).toBe('classify this');
  });

  it('does NOT send responseSchema by default — it suppresses optional slots', async () => {
    // Measured on gemini-3.5-flash-lite, same prompt, same question:
    //   with    -> {"intent":"movement_history","productQuery":"office chair"}
    //   without -> {..., "period":"last_7_days"}
    // Constrained decoding over the anyOf union drops OPTIONAL properties, and
    // every slot with a zod default is optional. That turns a caught failure
    // (malformed JSON) into a silent wrong answer (the default period).
    const fetchImpl = vi.fn().mockResolvedValue(reply(okBody('{"intent":"low_stock"}')));
    await makeProvider(fetchImpl as unknown as typeof fetch).complete(req);

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { generationConfig: Record<string, unknown> };
    expect(body.generationConfig['responseSchema']).toBeUndefined();
    // JSON mode still applies — the reparse ladder handles the rest.
    expect(body.generationConfig['responseMimeType']).toBe('application/json');
  });

  it('sends responseSchema when explicitly opted in', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(okBody('{"intent":"low_stock"}')));
    const provider = makeGeminiProvider({
      apiKey: 'k',
      model: 'gemini-2.5-flash',
      useResponseSchema: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await provider.complete(req);

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { generationConfig: Record<string, unknown> };
    expect(body.generationConfig['responseSchema']).toBeDefined();
  });

  it('DISABLES thinking on 2.5 models — thought tokens eat maxOutputTokens', async () => {
    // Observed for real: 244 of a 256-token budget spent thinking, MAX_TOKENS,
    // and the prose fragment "Here is the JSON requested:" instead of any JSON.
    // Chain-of-thought on a four-way label is also simply the wrong tool.
    const fetchImpl = vi.fn().mockResolvedValue(reply(okBody('{"intent":"low_stock"}')));
    await makeProvider(fetchImpl as unknown as typeof fetch).complete(req);

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      generationConfig: { thinkingConfig?: { thinkingBudget: number } };
    };
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });

  it('does NOT send thinkingConfig to models that reject the field', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(okBody('{"intent":"low_stock"}')));
    const provider = makeGeminiProvider({
      apiKey: 'k',
      model: 'gemini-2.0-flash',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await provider.complete(req);

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { generationConfig: Record<string, unknown> };
    expect(body.generationConfig['thinkingConfig']).toBeUndefined();
  });
});

describe('failure classification — what may be retried', () => {
  it('429 is a NON-retryable provider error (retrying only burns quota)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply({ error: { message: 'quota' } }, 429));

    const error = await makeProvider(fetchImpl as unknown as typeof fetch)
      .complete(req)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LlmProviderError);
    expect((error as LlmProviderError).retryable).toBe(false);
    expect((error as LlmProviderError).status).toBe(429);
  });

  it('401 is likewise terminal — a bad key does not heal within one retry', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply({}, 401));
    const error = await makeProvider(fetchImpl as unknown as typeof fetch)
      .complete(req)
      .catch((e: unknown) => e);
    expect((error as LlmProviderError).retryable).toBe(false);
  });

  it('5xx IS retryable', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply({}, 503));
    const error = await makeProvider(fetchImpl as unknown as typeof fetch)
      .complete(req)
      .catch((e: unknown) => e);
    expect((error as LlmProviderError).retryable).toBe(true);
    expect((error as LlmProviderError).status).toBe(503);
  });

  it('a timeout (AbortError) is NOT retried — the budget already elapsed', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fetchImpl = vi.fn().mockRejectedValue(abort);

    const error = await makeProvider(fetchImpl as unknown as typeof fetch)
      .complete(req)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LlmProviderError);
    expect((error as LlmProviderError).retryable).toBe(false);
    expect((error as Error).message).toMatch(/timed out/);
  });

  it('a transport failure is retryable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const error = await makeProvider(fetchImpl as unknown as typeof fetch)
      .complete(req)
      .catch((e: unknown) => e);
    expect((error as LlmProviderError).retryable).toBe(true);
  });

  it('an empty completion is a provider error, not an empty string to reparse', async () => {
    // Almost always a safety block or MAX_TOKENS — provider-side, and nothing
    // the JSON reparse ladder can fix, so it must not consume that retry.
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(reply({ candidates: [{ finishReason: 'SAFETY' }] }));

    const error = await makeProvider(fetchImpl as unknown as typeof fetch)
      .complete(req)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LlmProviderError);
    expect((error as Error).message).toContain('SAFETY');
  });

  it('a non-JSON body is retryable rather than fatal', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('<html>502</html>', { status: 200 }));
    const error = await makeProvider(fetchImpl as unknown as typeof fetch)
      .complete(req)
      .catch((e: unknown) => e);
    expect((error as LlmProviderError).retryable).toBe(true);
  });
});

describe('JSON Schema → the Gemini subset', () => {
  const converted = toGeminiSchema(intentJsonSchema) as Record<string, unknown>;

  it('rewrites oneOf → anyOf and const → enum, and drops rejected keywords', () => {
    const serialized = JSON.stringify(converted);

    expect(converted['anyOf']).toBeDefined();
    expect(converted['oneOf']).toBeUndefined();
    expect(serialized).not.toContain('"$schema"');
    expect(serialized).not.toContain('"additionalProperties"');
    expect(serialized).not.toContain('"const"');
    expect(serialized).toContain('"enum":["product_lookup"]');
  });

  it('keeps every intent — the transform must not silently drop a branch', () => {
    const branches = converted['anyOf'] as { properties: { intent: { enum: string[] } } }[];
    expect(branches.map((b) => b.properties.intent.enum[0]).sort()).toEqual([
      'low_stock',
      'movement_history',
      'product_lookup',
      'unsupported',
    ]);
  });

  it('leaves ordinary schema structure untouched', () => {
    const lookup = (converted['anyOf'] as Record<string, unknown>[]).find((b) =>
      JSON.stringify(b).includes('product_lookup'),
    ) as { type: string; properties: Record<string, { type: string; maxLength?: number }> };

    expect(lookup.type).toBe('object');
    expect(lookup.properties['productQuery']?.type).toBe('string');
    expect(lookup.properties['productQuery']?.maxLength).toBe(60);
  });
});
