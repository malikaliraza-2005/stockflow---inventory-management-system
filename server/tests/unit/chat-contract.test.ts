/**
 * Step 1 of the AI Inventory Assistant — the contract, before any provider
 * exists. Three things are asserted here and nowhere else:
 *
 *  - the schema ACCEPTS what a well-behaved model emits (including omitted
 *    defaults) and REJECTS the four ways it drifts (unknown intent, invented
 *    slot, wrong type, degenerate slot value);
 *  - the prompt and the schema cannot drift apart (every intent name and every
 *    slot key in the schema appears in the rendered prompt);
 *  - the fake provider is honest — it records calls and THROWS on exhaustion.
 */
import { describe, expect, it } from 'vitest';

import {
  buildSystemPrompt,
  FEW_SHOT_QUESTIONS,
  PROMPT_VERSION,
} from '../../src/services/chat/intentPrompt.js';
import {
  INTENT_NAMES,
  INTENT_SHAPES,
  intentJsonSchema,
  intentSchema,
} from '../../src/services/chat/intentSchema.js';
import { makeFakeProvider, makeFakeScript } from '../../src/services/llm/providers/fake.js';

describe('intent schema — what the model is allowed to say', () => {
  it('accepts a plain product lookup and trims the slot', () => {
    const parsed = intentSchema.parse({ intent: 'product_lookup', productQuery: '  Dell  ' });
    expect(parsed).toEqual({ intent: 'product_lookup', productQuery: 'Dell' });
  });

  it('accepts a slot-less product lookup (the model may legitimately omit both)', () => {
    expect(intentSchema.parse({ intent: 'product_lookup' })).toEqual({ intent: 'product_lookup' });
  });

  it('applies server-side defaults the model never has to emit', () => {
    expect(intentSchema.parse({ intent: 'low_stock' })).toEqual({ intent: 'low_stock', limit: 10 });
    expect(intentSchema.parse({ intent: 'movement_history', productQuery: 'XPS' })).toEqual({
      intent: 'movement_history',
      productQuery: 'XPS',
      period: 'last_30_days',
      limit: 20,
    });
  });

  it('rejects an intent name that is not in the catalogue', () => {
    expect(intentSchema.safeParse({ intent: 'delete_everything' }).success).toBe(false);
  });

  it('rejects an INVENTED slot key — strictObject is the drift alarm', () => {
    const result = intentSchema.safeParse({
      intent: 'product_lookup',
      productQuery: 'Dell',
      sortBy: 'price',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a one-character productQuery (it would match the whole catalogue)', () => {
    expect(intentSchema.safeParse({ intent: 'product_lookup', productQuery: 'a' }).success).toBe(
      false,
    );
    expect(
      intentSchema.safeParse({ intent: 'product_lookup', productQuery: 'a'.repeat(61) }).success,
    ).toBe(false);
  });

  it('rejects wrong slot types and out-of-range limits', () => {
    expect(intentSchema.safeParse({ intent: 'low_stock', limit: 'ten' }).success).toBe(false);
    expect(intentSchema.safeParse({ intent: 'low_stock', limit: 0 }).success).toBe(false);
    expect(intentSchema.safeParse({ intent: 'low_stock', limit: 51 }).success).toBe(false);
    expect(intentSchema.safeParse({ intent: 'low_stock', limit: 2.5 }).success).toBe(false);
  });

  it('rejects an invented period bucket rather than falling back to a default', () => {
    expect(
      intentSchema.safeParse({ intent: 'movement_history', period: '2026-01-01..2026-02-01' })
        .success,
    ).toBe(false);
  });

  it('exposes the four Phase-1 intents, derived from the union itself', () => {
    expect([...INTENT_NAMES].sort()).toEqual([
      'low_stock',
      'movement_history',
      'product_lookup',
      'unsupported',
    ]);
  });

  it('publishes an input-mode JSON Schema for constrained decoding', () => {
    const asRecord = intentJsonSchema as { oneOf?: unknown[] };
    expect(Array.isArray(asRecord.oneOf)).toBe(true);
    expect(asRecord.oneOf).toHaveLength(INTENT_NAMES.length);
    // io:'input' — defaulted slots must NOT be demanded of the model.
    expect(JSON.stringify(intentJsonSchema)).not.toContain('"required":["intent","period"]');
  });
});

describe('classifier prompt — generated from the schema, so it cannot drift', () => {
  const prompt = buildSystemPrompt();

  it('names every intent in the schema', () => {
    for (const name of INTENT_NAMES) {
      expect(prompt).toContain(name);
    }
  });

  it('documents every slot key in the schema', () => {
    for (const { slots } of INTENT_SHAPES) {
      for (const slot of slots) {
        expect(prompt).toContain(slot);
      }
    }
  });

  it('states the rules that actually carry the accuracy', () => {
    expect(prompt).toContain('SHORTEST DISTINCTIVE NOUN PHRASE');
    expect(prompt).toMatch(/read-only/i);
    expect(prompt).toMatch(/no markdown code fences/i);
  });

  it('carries a version so eval scores are attributable', () => {
    expect(PROMPT_VERSION).toMatch(/^v\d+$/);
  });

  it('every few-shot answer is itself a valid intent', () => {
    // The examples teach the schema; an example that would not parse teaches the
    // model to emit something we reject.
    const answers = prompt.match(/^A: (.+)$/gm) ?? [];
    expect(answers.length).toBe(FEW_SHOT_QUESTIONS.length);
    for (const line of answers) {
      const json: unknown = JSON.parse(line.slice(3));
      expect(intentSchema.safeParse(json).success).toBe(true);
    }
  });
});

describe('fake provider — the seam every later step is tested through', () => {
  const req = {
    system: 'sys',
    user: 'how many laptops?',
    maxTokens: 256,
    temperature: 0,
    signal: AbortSignal.timeout(1_000),
  };

  it('returns scripted RAW text and records the request', () => {
    const script = makeFakeScript(['{"intent":"unsupported"}']);
    const provider = makeFakeProvider(script);

    return provider.complete(req).then((res) => {
      expect(res.text).toBe('{"intent":"unsupported"}');
      expect(script.calls).toHaveLength(1);
      expect(script.calls[0]?.user).toBe('how many laptops?');
      expect(provider.id).toBe('fake');
    });
  });

  it('THROWS when the script runs dry — an extra LLM call must fail the test', () => {
    const provider = makeFakeProvider(makeFakeScript([]));
    expect(() => provider.complete(req)).toThrow(/script exhausted/);
  });

  it('can script an outage', async () => {
    const provider = makeFakeProvider(makeFakeScript([new Error('429 quota exceeded')]));
    await expect(provider.complete(req)).rejects.toThrow(/quota/);
  });
});
