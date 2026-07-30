/**
 * One adapter for every provider that speaks the OpenAI chat-completions shape.
 *
 * ⚠️ GROQ vs GROK — these are DIFFERENT COMPANIES with nearly identical names,
 * and mixing them up costs an afternoon:
 *
 *   groq  → Groq, console.groq.com, api.groq.com — an INFERENCE provider running
 *           open models (Llama, Kimi, GPT-OSS) on custom hardware. Very fast,
 *           generous free tier. Keys start `gsk_`.
 *   grok  → xAI, console.x.ai, api.x.ai — xAI's own MODEL family. Pay-as-you-go.
 *           Keys start `xai-`.
 *
 * Both are registered, both are one line each, and the difference is documented
 * here rather than in a commit message nobody re-reads.
 *
 * No `json_schema` response format for either. Gemini's constrained decoding
 * silently dropped every OPTIONAL slot (see gemini.ts), turning a rare caught
 * failure into a common silent wrong answer; until that is measured here, the
 * same risk is assumed. `json_object` mode plus the reparse-then-strict-zod
 * ladder is the safer trade.
 */
import {
  isExhaustedStatus,
  LlmProviderError,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
} from '../types.js';

export interface OpenAiCompatibleConfig {
  /** Provider id as it appears in the log record — 'groq' | 'grok'. */
  id: string;
  /** Human label used in error messages. */
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Test seam — inject a stub `fetch` instead of reaching the network. */
  fetchImpl?: typeof fetch;
}

interface ChatCompletionBody {
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export function makeOpenAiCompatibleProvider(config: OpenAiCompatibleConfig): LlmProvider {
  const doFetch = config.fetchImpl ?? fetch;

  return {
    id: config.id,
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
        response = await doFetch(`${config.baseUrl}/chat/completions`, {
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
          aborted
            ? `${config.label} request timed out.`
            : `${config.label} request failed to dispatch.`,
          { retryable: !aborted },
        );
      }

      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).slice(0, 300).replace(/\s+/g, ' ');
        throw new LlmProviderError(
          `${config.label} responded ${String(response.status)}${detail === '' ? '' : `: ${detail}`}`,
          {
            retryable: response.status >= 500,
            status: response.status,
            // 402 matters more here than for Gemini: these are pay-as-you-go or
            // free-tier-with-a-hard-stop, so "out of credit" is everyday.
            exhausted: isExhaustedStatus(response.status),
          },
        );
      }

      let parsed: ChatCompletionBody;
      try {
        parsed = (await response.json()) as ChatCompletionBody;
      } catch {
        throw new LlmProviderError(`${config.label} returned a non-JSON body.`, {
          retryable: true,
        });
      }

      const text = parsed.choices?.[0]?.message?.content ?? '';
      if (text.trim() === '') {
        throw new LlmProviderError(
          `${config.label} returned no text (finish_reason: ${
            parsed.choices?.[0]?.finish_reason ?? 'unknown'
          }).`,
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

export interface VendorConfig {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}

/** Groq — the inference provider (console.groq.com). Keys start `gsk_`. */
export function makeGroqProvider(config: VendorConfig): LlmProvider {
  return makeOpenAiCompatibleProvider({
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    ...config,
  });
}

/** Grok — xAI's model family (console.x.ai). Keys start `xai-`. */
export function makeGrokProvider(config: VendorConfig): LlmProvider {
  return makeOpenAiCompatibleProvider({
    id: 'grok',
    label: 'Grok',
    baseUrl: 'https://api.x.ai/v1',
    ...config,
  });
}
