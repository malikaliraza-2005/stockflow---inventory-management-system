/**
 * The OpenAI-compatible adapter, through an injected `fetch` — it backs BOTH
 * Groq (the inference provider, api.groq.com) and Grok (xAI, api.x.ai). Those
 * are different companies one letter apart, so the endpoint assertions below
 * are the guard against wiring a key to the wrong host.
 *
 * Same contract as the Gemini adapter — the whole point of the port is that
 * ChatService cannot tell them apart — so the assertions mirror it: JSON mode,
 * the key in a header, and failure classification that distinguishes "wait"
 * from "this account is spent".
 */
import { describe, expect, it, vi } from 'vitest';

import {
  makeGrokProvider,
  makeGroqProvider,
} from '../../src/services/llm/providers/openaiCompatible.js';
import { LlmProviderError } from '../../src/services/llm/types.js';

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function okBody(content: string) {
  return {
    choices: [{ message: { content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 700, completion_tokens: 14 },
  };
}

function makeProvider(fetchImpl: typeof fetch) {
  return makeGroqProvider({
    apiKey: 'gsk-test-key',
    model: 'llama-3.3-70b-versatile',
    fetchImpl,
  });
}

const req = {
  system: 'classify this',
  user: 'how many laptops?',
  maxTokens: 256,
  temperature: 0,
  signal: AbortSignal.timeout(5_000),
};

describe('request shaping', () => {
  it('sends OpenAI-shaped messages, JSON mode, and a bearer key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(okBody('{"intent":"low_stock"}')));
    const res = await makeProvider(fetchImpl as unknown as typeof fetch).complete(req);

    expect(res.text).toBe('{"intent":"low_stock"}');
    expect(res.inputTokens).toBe(700);
    expect(res.outputTokens).toBe(14);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(url).not.toContain('gsk-test-key'); // never in a URL — access logs
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer gsk-test-key');

    const body = JSON.parse(init.body as string) as {
      model: string;
      temperature: number;
      response_format: { type: string };
      messages: { role: string; content: string }[];
    };
    expect(body.model).toBe('llama-3.3-70b-versatile');
    expect(body.temperature).toBe(0);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(body.messages[0]?.content).toBe('classify this');
  });
});

describe('the two lookalike vendors are wired to DIFFERENT hosts', () => {
  // Groq and Grok differ by one letter. Sending a gsk_ key to api.x.ai (or the
  // reverse) fails as a 401, which the chain reads as "account spent" and
  // silently fails over — a misconfiguration disguised as an outage.
  it.each([
    ['groq', makeGroqProvider, 'https://api.groq.com/openai/v1/chat/completions'],
    ['grok', makeGrokProvider, 'https://api.x.ai/v1/chat/completions'],
  ])('%s posts to %s', async (id, make, expectedUrl) => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(okBody('{"intent":"low_stock"}')));
    const provider = make({
      apiKey: 'k',
      model: 'm',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await provider.complete(req);

    expect(provider.id).toBe(id);
    expect((fetchImpl.mock.calls[0] as [string, RequestInit])[0]).toBe(expectedUrl);
  });
});

describe('failure classification', () => {
  it.each([
    [429, 'quota'],
    [402, 'out of credit'],
    [401, 'bad key'],
  ])('marks %i as EXHAUSTED so the chain fails over (%s)', async (status) => {
    const fetchImpl = vi.fn().mockResolvedValue(reply({ error: 'nope' }, status));

    const error = (await makeProvider(fetchImpl as unknown as typeof fetch)
      .complete(req)
      .catch((e: unknown) => e)) as LlmProviderError;

    expect(error).toBeInstanceOf(LlmProviderError);
    expect(error.exhausted).toBe(true);
    expect(error.retryable).toBe(false);
    expect(error.status).toBe(status);
  });

  it('a 5xx is retryable but NOT exhaustion — a blip is not an empty account', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply({}, 503));
    const error = (await makeProvider(fetchImpl as unknown as typeof fetch)
      .complete(req)
      .catch((e: unknown) => e)) as LlmProviderError;

    expect(error.retryable).toBe(true);
    expect(error.exhausted).toBe(false);
  });

  it('a timeout is neither retryable nor exhaustion', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fetchImpl = vi.fn().mockRejectedValue(abort);

    const error = (await makeProvider(fetchImpl as unknown as typeof fetch)
      .complete(req)
      .catch((e: unknown) => e)) as LlmProviderError;

    expect(error.message).toMatch(/timed out/);
    expect(error.retryable).toBe(false);
    expect(error.exhausted).toBe(false);
  });

  it('carries the upstream reason, not just the status', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(reply({ error: { message: 'credits exhausted' } }, 402));
    const error = (await makeProvider(fetchImpl as unknown as typeof fetch)
      .complete(req)
      .catch((e: unknown) => e)) as Error;

    expect(error.message).toContain('credits exhausted');
    expect(error.message).toContain('Groq');
  });

  it('an empty completion is a provider error, not text to reparse', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply({ choices: [{ finish_reason: 'length' }] }));
    const error = (await makeProvider(fetchImpl as unknown as typeof fetch)
      .complete(req)
      .catch((e: unknown) => e)) as Error;

    expect(error.message).toContain('length');
  });
});
