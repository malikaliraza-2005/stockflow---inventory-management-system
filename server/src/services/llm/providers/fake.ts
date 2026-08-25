/**
 * FakeLlmProvider — the provider every test uses, and the default in dev.
 *
 * Responses are RAW STRINGS, not parsed objects, on purpose: a test can script
 * malformed JSON, a fenced ```json block, or an invented slot key and exercise
 * the REAL parsing path (fallback cases JSON_PARSE_FAILED /
 * SCHEMA_VALIDATION_FAILED) rather than a mock of it.
 */
import { LlmProviderError, type LlmProvider, type LlmRequest, type LlmResponse } from '../types.js';

export interface FakeScript {
  /** Raw completion texts, consumed in order (or a thrown error to simulate an outage). */
  responses: (string | Error)[];
  /** Every request the system under test made — assert on system/user/json/signal. */
  calls: LlmRequest[];
}

export function makeFakeScript(responses: (string | Error)[] = []): FakeScript {
  return { responses, calls: [] };
}

export function makeFakeProvider(script: FakeScript): LlmProvider {
  return {
    id: 'fake',
    model: 'fake-1',
    complete(req: LlmRequest): Promise<LlmResponse> {
      script.calls.push(req);

      if (req.signal.aborted) {
        return Promise.reject(
          new LlmProviderError('Aborted before dispatch.', { retryable: false }),
        );
      }

      const next = script.responses.shift();
      // Exhaustion THROWS rather than returning a default: a test that silently
      // makes one more LLM call than expected and still passes is worse than a
      // test that fails.
      if (next === undefined) {
        throw new Error('FakeLlmProvider: script exhausted — more calls than expected.');
      }
      if (next instanceof Error) return Promise.reject(next);

      return Promise.resolve({ text: next, inputTokens: 0, outputTokens: 0 });
    },
  };
}

/**
 * The RUNTIME `fake` provider (dev default, and what `LLM_PROVIDER=fake` selects).
 *
 * Separate from the scripted one on purpose: script exhaustion must throw in a
 * test, but a long-running dev server needs a provider that answers forever.
 * It classifies everything as `unsupported`, which renders as the capability
 * list — a truthful "not configured yet", never a plausible fabrication.
 */
export function makeStubProvider(): LlmProvider {
  return {
    id: 'fake',
    model: 'stub-unsupported',
    complete(): Promise<LlmResponse> {
      return Promise.resolve({ text: '{"intent":"unsupported"}', inputTokens: 0, outputTokens: 0 });
    },
  };
}
