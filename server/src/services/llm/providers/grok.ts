/**
 * xAI Grok — the second real provider.
 *
 * The plan said "do not build a second provider; swapping later is one file
 * plus one switch arm". This IS that file and that arm: it arrived because a
 * concrete operational problem showed up (a spent free-tier quota blocking all
 * work), which is exactly the trigger that was named.
 *
 * xAI speaks the OpenAI chat-completions shape, so this adapter is deliberately
 * boring — the only interesting parts are the same two as Gemini: JSON mode,
 * and honest failure classification.
 *
 * No `response_format: json_schema` here either. Gemini's constrained decoding
 * silently dropped every optional slot (see gemini.ts), and until that is
 * measured on xAI the same risk is assumed: `json_object` mode plus the
 * reparse-then-strict-zod ladder trades a rare CAUGHT failure for no silent
 * ones.
 */
import {
  isExhaustedStatus,
  LlmProviderError,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
} from '../types.js';

const API_BASE = 'https://api.x.ai/v1';

export interface GrokConfig {
  apiKey: string;
  model: string;
  /** Test seam — inject a stub `fetch` instead of reaching the network. */
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

interface GrokBody {
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export function makeGrokProvider(config: GrokConfig): LlmProvider {
  const doFetch = config.fetchImpl ?? fetch;
  const baseUrl = config.baseUrl ?? API_BASE;

  return {
    id: 'grok',
    model: config.model,

    async complete(req: LlmRequest): Promise<LlmResponse> {
      const body = {
        model: config.model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        temperature: req.temperature,
        max_tokens: req.maxTokens,
        response_format: { type: 'json_object' },
      };

      let response: Response;
      try {
        response = await doFetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: req.signal,
        });
      } catch (error) {
        const aborted = (error as { name?: string }).name === 'AbortError';
        throw new LlmProviderError(
          aborted ? 'Grok request timed out.' : 'Grok request failed to dispatch.',
          { retryable: !aborted },
        );
      }

      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).slice(0, 300).replace(/\s+/g, ' ');
        throw new LlmProviderError(
          `Grok responded ${String(response.status)}${detail === '' ? '' : `: ${detail}`}`,
          {
            retryable: response.status >= 500,
            status: response.status,
            // 402 matters here in a way it does not for Gemini: xAI is
            // pay-as-you-go, so "out of credit" is the everyday exhaustion.
            exhausted: isExhaustedStatus(response.status),
          },
        );
      }

      let parsed: GrokBody;
      try {
        parsed = (await response.json()) as GrokBody;
      } catch {
        throw new LlmProviderError('Grok returned a non-JSON body.', { retryable: true });
      }

      const text = parsed.choices?.[0]?.message?.content ?? '';
      if (text.trim() === '') {
        throw new LlmProviderError(
          `Grok returned no text (finish_reason: ${parsed.choices?.[0]?.finish_reason ?? 'unknown'}).`,
          { retryable: false },
        );
      }

      return {
        text,
        inputTokens: parsed.usage?.prompt_tokens ?? 0,
        outputTokens: parsed.usage?.completion_tokens ?? 0,
      };
    },
  };
}
