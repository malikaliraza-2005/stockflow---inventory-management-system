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
  /** Test seam — inject a stub `fetch` instead of reaching the network. */
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

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
          ...(req.json ? { responseSchema: toGeminiSchema(req.json.schema) } : {}),
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
        // 4xx is terminal by policy: a bad key or an exhausted quota does not
        // heal within one retry, and retrying 429 burns what is left.
        throw new LlmProviderError(`Gemini responded ${String(response.status)}.`, {
          retryable: response.status >= 500,
          status: response.status,
        });
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
