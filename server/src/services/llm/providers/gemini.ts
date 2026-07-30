/**
 * The ONE real provider — Gemini, free tier.
 *
 * Plain `fetch`, no SDK: the surface we use is a single POST with a JSON body,
 * and an SDK here would add a dependency, a release cadence and a vendor type
 * leak for no behaviour we need. Everything vendor-shaped stops at this file.
 *
 * Two things matter more than the transport:
 *
 *  - **Constrained decoding.** `responseMimeType: application/json` +
 *    `responseSchema` makes the JSON_PARSE_FAILED and SCHEMA_VALIDATION_FAILED
 *    fallbacks nearly unreachable rather than merely catchable. Gemini accepts
 *    an OpenAPI-3.0 *subset*, not full JSON Schema — hence `toGeminiSchema`.
 *  - **Failure classification.** 5xx/network is retryable ONCE; 4xx (401 bad
 *    key, 429 quota) is NOT — retrying a quota failure only burns more quota,
 *    and on a free tier quota exhaustion is the EXPECTED failure, not an edge
 *    case. Either way the caller sees `LlmProviderError`, never a raw throw.
 */
import { LlmProviderError, type LlmProvider, type LlmRequest, type LlmResponse } from '../types.js';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface GeminiConfig {
  apiKey: string;
  model: string;
  /**
   * Send `responseSchema` (constrained decoding). DEFAULT OFF, against the
   * original design intent, because measurement contradicted it.
   *
   * Same question, same prompt, gemini-3.5-flash-lite:
   *   with    → {"intent":"movement_history","productQuery":"office chair"}
   *   without → {"intent":"movement_history","productQuery":"office chair",
   *              "period":"last_7_days"}
   *
   * Constrained decoding over our `anyOf` union suppresses OPTIONAL properties
   * outright, and every slot carrying a zod `.default()` is optional in the
   * model's view. The schema was supposed to make malformed output impossible;
   * in practice it made `period` unreachable, which is a silently WRONG answer
   * ("last 30 days" for "everything ever recorded") rather than a caught one.
   * Prompt wording cannot beat the decoder — v2 and v3 both tried.
   *
   * Malformed JSON stays cheap to handle: `responseMimeType: application/json`
   * still applies, and the reparse-then-strict-zod ladder exists precisely for
   * this. Trading a rare, CAUGHT failure for a common, SILENT one is the wrong
   * trade. Left as a flag because a future model may handle unions properly.
   */
  useResponseSchema?: boolean;
  /** Test seam — inject a stub `fetch` instead of reaching the network. */
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

/**
 * Models whose "thinking" must be switched OFF explicitly.
 *
 * Gemini 2.5 reasons before answering, and those thought tokens are billed
 * against `maxOutputTokens`. With our 256-token budget a single classification
 * spent 244 tokens thinking, hit MAX_TOKENS, and returned the prose fragment
 * "Here is the JSON requested:" instead of any JSON — every call failing, in a
 * way that looks like a parse bug rather than a config one.
 *
 * Thinking is also simply wrong for this task: the job is to emit one label
 * from a closed set, and chain-of-thought on a four-way choice buys nothing
 * while costing latency, quota, and reproducibility (which `temperature: 0`
 * exists to guarantee).
 */
const THINKING_MODELS = /^gemini-2\.5|thinking/i;

/**
 * JSON Schema → the Gemini `responseSchema` subset.
 *
 * Three concrete incompatibilities, all mechanical:
 *   `oneOf` → `anyOf`  ·  `const: x` → `enum: [x]`  ·  drop `$schema`,
 *   `additionalProperties` and other keywords it rejects outright.
 *
 * Written as a transform over the zod-generated schema rather than a
 * hand-maintained second copy — a hand-copied schema is exactly the artifact
 * that drifts from `intentSchema.ts` the first time an intent is added.
 */
export function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (schema === null || typeof schema !== 'object') return schema;

  const source = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(source)) {
    switch (key) {
      case '$schema':
      case 'additionalProperties':
      case 'default':
        continue; // not part of the accepted subset
      case 'oneOf':
        out['anyOf'] = toGeminiSchema(value);
        continue;
      case 'const':
        out['enum'] = [value];
        continue;
      default:
        out[key] = toGeminiSchema(value);
    }
  }

  // A `const`-derived enum needs its type to stay declared alongside it.
  if (out['enum'] !== undefined && out['type'] === undefined) out['type'] = 'string';
  return out;
}

interface GeminiPart {
  text?: string;
}
interface GeminiCandidate {
  content?: { parts?: GeminiPart[] };
  finishReason?: string;
}
interface GeminiBody {
  candidates?: GeminiCandidate[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string };
}

export function makeGeminiProvider(config: GeminiConfig): LlmProvider {
  const doFetch = config.fetchImpl ?? fetch;
  const baseUrl = config.baseUrl ?? API_BASE;

  return {
    id: 'gemini',
    model: config.model,

    async complete(req: LlmRequest): Promise<LlmResponse> {
      const body = {
        system_instruction: { parts: [{ text: req.system }] },
        contents: [{ role: 'user', parts: [{ text: req.user }] }],
        generationConfig: {
          temperature: req.temperature,
          maxOutputTokens: req.maxTokens,
          responseMimeType: 'application/json',
          // Sent ONLY to models that support it — 2.0 and earlier reject the field.
          ...(THINKING_MODELS.test(config.model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          ...(req.json && config.useResponseSchema === true
            ? { responseSchema: toGeminiSchema(req.json.schema) }
            : {}),
        },
      };

      let response: Response;
      try {
        response = await doFetch(`${baseUrl}/${encodeURIComponent(config.model)}:generateContent`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            // Header, never a query string — a key in a URL lands in access logs.
            'x-goog-api-key': config.apiKey,
          },
          body: JSON.stringify(body),
          signal: req.signal,
        });
      } catch (error) {
        // AbortError (LLM_TIMEOUT_MS) and transport failures both land here.
        const aborted = (error as { name?: string }).name === 'AbortError';
        throw new LlmProviderError(
          aborted ? 'Gemini request timed out.' : 'Gemini request failed to dispatch.',
          { retryable: !aborted },
        );
      }

      if (!response.ok) {
        // Carry the upstream REASON, not just the status. "429" alone cannot
        // distinguish per-minute throttling (wait) from a spent daily quota
        // (stop) from a model the key cannot reach at all (reconfigure) — and
        // those need opposite responses. Bounded, and the body never contains
        // the key.
        const detail = (await response.text().catch(() => '')).slice(0, 300).replace(/\s+/g, ' ');
        throw new LlmProviderError(
          `Gemini responded ${String(response.status)}${detail === '' ? '' : `: ${detail}`}`,
          { retryable: response.status >= 500, status: response.status },
        );
      }

      let parsed: GeminiBody;
      try {
        parsed = (await response.json()) as GeminiBody;
      } catch {
        throw new LlmProviderError('Gemini returned a non-JSON body.', { retryable: true });
      }

      const text = parsed.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      if (text.trim() === '') {
        // Empty completions are almost always a safety block or MAX_TOKENS —
        // both are provider-side, not something the parse ladder can fix.
        throw new LlmProviderError(
          `Gemini returned no text (finishReason: ${parsed.candidates?.[0]?.finishReason ?? 'unknown'}).`,
          { retryable: false },
        );
      }

      return {
        text,
        inputTokens: parsed.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: parsed.usageMetadata?.candidatesTokenCount ?? 0,
      };
    },
  };
}
