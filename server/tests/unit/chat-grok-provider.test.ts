/**
 * The xAI Grok adapter, through an injected `fetch`.
 *
 * Same contract as the Gemini adapter — the whole point of the port is that
 * ChatService cannot tell them apart — so the assertions mirror it: JSON mode,
 * the key in a header, and failure classification that distinguishes "wait"
 * from "this account is spent".
 */
import { describe, expect, it, vi } from 'vitest';

import { makeGrokProvider } from '../../src/services/llm/providers/grok.js';
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
  return makeGrokProvider({
    apiKey: 'xai-test-key',
    model: 'grok-4-fast-non-reasoning',
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
    expect(url).toContain('/chat/completions');
    expect(url).not.toContain('xai-test-key'); // never in a URL — access logs
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer xai-test-key');

    const body = JSON.parse(init.body as string) as {
      model: string;
      temperature: number;
      response_format: { type: string };
      messages: { role: string; content: string }[];
    };
    expect(body.model).toBe('grok-4-fast-non-reasoning');
    expect(body.temperature).toBe(0);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(body.messages[0]?.content).toBe('classify this');
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
  });

  it('an empty completion is a provider error, not text to reparse', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply({ choices: [{ finish_reason: 'length' }] }));
    const error = (await makeProvider(fetchImpl as unknown as typeof fetch)
      .complete(req)
      .catch((e: unknown) => e)) as Error;

    expect(error.message).toContain('length');
  });
});
