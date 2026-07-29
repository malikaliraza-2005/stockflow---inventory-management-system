/**
 * The ENTIRE vendor boundary for the AI Inventory Assistant.
 *
 * ZERO vendor imports live in this file — that is the whole point. Swapping
 * Gemini for anything else is one new `providers/*.ts` plus one arm of the
 * `switch` in `providers/index.ts`; nothing in `services/chat/**` changes.
 *
 * It stays this small because the assistant does exactly ONE thing with an LLM:
 * turn a sentence into a strict-zod intent. No tool calling, no agent loop, no
 * response generation — so there is no tool/message/streaming vocabulary to
 * model here.
 */

export interface LlmRequest {
  system: string;
  user: string;
  /**
   * JSON Schema for the expected output — passed as a schema, never a boolean.
   * Providers with constrained decoding (Gemini) use it to make the
   * JSON_PARSE_FAILED / SCHEMA_VALIDATION_FAILED fallbacks nearly impossible
   * rather than merely catchable; providers without it fall back to
   * prompt-and-reparse.
   */
  json?: { schema: unknown };
  /** 256 — the output is one small object. */
  maxTokens: number;
  /** 0 — classification must be reproducible for the eval set to mean anything. */
  temperature: number;
  /**
   * REQUIRED, not optional. An optional timeout on a call sitting in the request
   * path is one that someone eventually forgets to pass. Driven by LLM_TIMEOUT_MS.
   */
  signal: AbortSignal;
}

export interface LlmResponse {
  text: string;
  /** Logged per message — on a free tier, quota is the binding constraint. */
  inputTokens: number;
  outputTokens: number;
}

export interface LlmProvider {
  /** 'gemini' | 'fake' — goes into the per-message log record. */
  readonly id: string;
  readonly model: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

/**
 * Provider failure — thrown by adapters for timeout / quota / 5xx / transport.
 * ChatService maps this to fallback `PROVIDER_UNAVAILABLE` and a clean 503;
 * it must never surface as a 500 (RISK-4).
 */
export class LlmProviderError extends Error {
  /** True for network blips and 5xx — the ONE retry is gated on this. */
  readonly retryable: boolean;
  /** Upstream HTTP status when there was one. */
  readonly status: number | undefined;

  constructor(
    message: string,
    opts: { retryable: boolean; status?: number | undefined } = { retryable: false },
  ) {
    super(message);
    this.name = 'LlmProviderError';
    this.retryable = opts.retryable;
    this.status = opts.status;
  }
}
