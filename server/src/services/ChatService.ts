/**
 * ChatService — the AI Inventory Assistant's orchestration, in three functions:
 *
 *     classify()  →  dispatch()  →  render()
 *
 * Not one method with seven branches. Split this way each stage is
 * independently testable, and the RBAC check has an obvious home at the top of
 * `dispatch()` — before any handler reads anything.
 *
 * Exactly ONE LLM call per message (two only when the first reply wasn't JSON),
 * no loop, no tools, no memory. The model's entire job is turning a sentence
 * into a validated intent; everything after `intentSchema.parse` is
 * deterministic code, and nothing it emits reaches Mongo — only validated slot
 * values reach hand-written filters.
 *
 * Tenant safety: handlers run INLINE on the caller's async chain, so the
 * request's `AsyncLocalStorage` tenant store is live and `tenantScopePlugin`
 * scopes every query automatically. Never move this to a queue, a detached
 * promise, a background worker, or an internal HTTP call.
 */
import { ServiceUnavailableError } from '../errors/AppError.js';
import type { Logger } from '../lib/logger.js';
import { getTenantId } from '../lib/tenantContext.js';
import { rolesFor } from '../config/permissionMatrix.js';
import type { UserRole } from '../models/User.js';
import { fallback, type ChatFallback } from './chat/fallback.js';
import { handleLowStock } from './chat/handlers/lowStock.js';
import { handleMovementHistory } from './chat/handlers/movementHistory.js';
import { handleProductLookup } from './chat/handlers/productLookup.js';
import type { ChatHandlerDeps, HandlerOutcome } from './chat/handlers/shared.js';
import { buildSystemPrompt, buildUserPrompt, PROMPT_VERSION } from './chat/intentPrompt.js';
import { intentJsonSchema, intentSchema, type Intent } from './chat/intentSchema.js';
import { forbiddenSummary, unsupportedSummary } from './chat/templates.js';
import {
  CAPABILITY_BLURBS,
  EXAMPLE_QUESTIONS,
  INTENT_CAPABILITY,
  type ChatResult,
} from './chat/types.js';
import { LlmProviderError, type LlmProvider } from './llm/types.js';
import type { ProductService } from './ProductService.js';
import type { TransactionService } from './TransactionService.js';

/** Short, fixed backoff before the ONE retry. Long enough to clear a blip,
 *  short enough that a user waiting on a chat reply doesn't notice. */
const RETRY_DELAY_MS = 250;

export interface ChatServiceConfig {
  maxTokens: number;
  timeoutMs: number;
}

export interface ChatServiceDeps {
  llm: LlmProvider;
  products: ProductService;
  transactions: TransactionService;
  config: ChatServiceConfig;
  /** Injected clock — period resolution is testable without freezing time. */
  now?: () => Date;
}

export interface ChatActor {
  id: string;
  role: UserRole;
}

export interface ChatAsk {
  question: string;
  /** Client-generated UUID per chat session. LOG FIELD ONLY — there is no
   *  Conversation collection and no memory. It costs one field and it is what
   *  lets you reconstruct sequences later: what a user asked immediately after
   *  an `unsupported` answer is the highest-signal datum for choosing intent #5,
   *  and it is unrecoverable without a session key. */
  conversationId: string;
  actor: ChatActor;
  /** `requestId.ts`'s value. ONE chat message is exactly ONE HTTP request, so
   *  this is the per-message identifier — a separate `chatMessageId` would be a
   *  second unique key for the same thing. Returning it in the body is what lets
   *  a thumbs-up join to this log record without a fragile client-side index. */
  correlationId: string;
  /** The REQUEST's correlation id (which may be client-supplied). Logged beside
   *  the minted `correlationId` so a chat record and the HTTP completion line
   *  stay joinable without making the trace id the feedback join key. */
  requestId: string;
  logger: Logger;
}

export interface Classification {
  intent: Intent;
  /**
   * The model's RAW completion, before parsing.
   *
   * Exposed because `intent` is post-zod, and zod applies defaults — so a model
   * that omitted `period` entirely is indistinguishable from one that chose
   * `last_30_days`. Reading the parsed value as model output hid a real
   * constrained-decoding defect for two prompt revisions.
   */
  raw: string;
  fallback: ChatFallback | null;
  llmMs: number;
  inputTokens: number;
  outputTokens: number;
}

export class ChatService {
  private readonly llm: LlmProvider;
  private readonly config: ChatServiceConfig;
  private readonly handlerDeps: ChatHandlerDeps;

  constructor(deps: ChatServiceDeps) {
    this.llm = deps.llm;
    this.config = deps.config;
    this.handlerDeps = {
      products: deps.products,
      transactions: deps.transactions,
      now: deps.now ?? (() => new Date()),
    };
  }

  /** One message in, one answer out, one structured log record written. */
  async ask(input: ChatAsk): Promise<ChatResult> {
    const startedAt = performance.now();
    let classification: Classification;

    try {
      classification = await this.classify(input.question);
    } catch (error) {
      // RISK-4: a provider being slow, rate-limited or down must produce a clean
      // "assistant unavailable", never a 500 and never a hung request. On a free
      // tier, quota exhaustion is the EXPECTED failure, not an edge case.
      this.log(input, {
        intent: null,
        slots: null,
        fallbackRecord: fallback(
          'PROVIDER_UNAVAILABLE',
          error instanceof LlmProviderError && error.status !== undefined
            ? `status:${String(error.status)}`
            : undefined,
        ),
        resultCount: 0,
        llmMs: Math.round(performance.now() - startedAt),
        handlerMs: 0,
        totalMs: Math.round(performance.now() - startedAt),
        inputTokens: 0,
        outputTokens: 0,
      });
      throw new ServiceUnavailableError(30, 'The assistant is unavailable right now.');
    }

    const handlerStartedAt = performance.now();
    const outcome = await this.dispatch(classification.intent, input.actor);
    const handlerMs = Math.round(performance.now() - handlerStartedAt);

    // A classification-stage fallback (bad JSON, schema violation) is the more
    // interesting one — it explains WHY the intent is `unsupported`.
    const effective = classification.fallback ?? outcome.fallback;
    const { intent: name, ...slots } = classification.intent;

    this.log(input, {
      intent: name,
      slots,
      fallbackRecord: effective,
      resultCount: outcome.resultCount,
      llmMs: classification.llmMs,
      handlerMs,
      totalMs: Math.round(performance.now() - startedAt),
      inputTokens: classification.inputTokens,
      outputTokens: classification.outputTokens,
    });

    return this.render(outcome);
  }

  // ── stage 1: understand (the ONLY LLM call) ───────────────────────────

  /**
   * Sentence → validated intent. Every failure mode below degrades to
   * `unsupported` with a NAMED fallback rather than throwing: an assistant that
   * says "I can't answer that" is correct, while one that 500s is broken.
   */
  async classify(question: string): Promise<Classification> {
    const startedAt = performance.now();
    const system = buildSystemPrompt();

    const first = await this.complete(system, buildUserPrompt(question));
    let text = first.text;
    let inputTokens = first.inputTokens;
    let outputTokens = first.outputTokens;

    let raw = parseJson(text);
    if (raw === undefined) {
      // JSON_PARSE_FAILED — one reparse retry, telling the model what went
      // wrong. Distinct from the transport retry in `complete()`: this one is
      // about the CONTENT, and it is worth exactly one attempt.
      const second = await this.complete(
        system,
        `${question}\n\nYour previous reply was not valid JSON. Reply with ONLY the JSON object, no code fences.`,
      );
      text = second.text;
      inputTokens += second.inputTokens;
      outputTokens += second.outputTokens;
      raw = parseJson(text);

      if (raw === undefined) {
        return {
          intent: { intent: 'unsupported' },
          raw: text,
          fallback: fallback('JSON_PARSE_FAILED', 'reparse_exhausted'),
          llmMs: Math.round(performance.now() - startedAt),
          inputTokens,
          outputTokens,
        };
      }
    }

    const parsed = intentSchema.safeParse(raw);
    if (!parsed.success) {
      // THE safety net. An unknown intent, a wrong type, or an invented slot key
      // all land here — which is exactly why the schema uses strictObject.
      // `details` is the zod issue code + path: machine-shaped, and it never
      // carries the user's question.
      return {
        intent: { intent: 'unsupported' },
        raw: text,
        fallback: fallback(
          'SCHEMA_VALIDATION_FAILED',
          parsed.error.issues
            .slice(0, 3)
            .map((issue) => {
              // `unrecognized_keys` (the invented-slot case) reports at the root,
              // so the KEY is the whole diagnostic — without it the record says
              // only "something extra", which is not actionable.
              const where =
                issue.code === 'unrecognized_keys'
                  ? issue.keys.join('+')
                  : issue.path.join('.') || '(root)';
              return `${issue.code}:${where}`;
            })
            .join(','),
        ),
        llmMs: Math.round(performance.now() - startedAt),
        inputTokens,
        outputTokens,
      };
    }

    return {
      intent: parsed.data,
      raw: text,
      fallback: null,
      llmMs: Math.round(performance.now() - startedAt),
      inputTokens,
      outputTokens,
    };
  }

  // ── stage 2: fetch (no LLM) ───────────────────────────────────────────

  /**
   * A `switch` into a hand-written handler, gated on the caller's capability.
   * Nothing the model produced reaches Mongo: the validated slot values are
   * copied into filters the handlers build themselves.
   */
  async dispatch(intent: Intent, actor: ChatActor): Promise<HandlerOutcome> {
    const capability = INTENT_CAPABILITY[intent.intent];
    if (capability !== null && !rolesFor(capability).includes(actor.role)) {
      // Refused BEFORE the handler runs, so nothing was read at all.
      return {
        result: {
          intent: 'unsupported',
          summary: forbiddenSummary(),
          capabilities: [...CAPABILITY_BLURBS],
          examples: [...EXAMPLE_QUESTIONS],
        },
        fallback: fallback('FORBIDDEN', capability),
        resultCount: 0,
      };
    }

    switch (intent.intent) {
      case 'product_lookup':
        return handleProductLookup(intent, this.handlerDeps);
      case 'low_stock':
        return handleLowStock(intent, this.handlerDeps);
      case 'movement_history':
        return handleMovementHistory(intent, this.handlerDeps);
      case 'unsupported':
        return {
          result: {
            intent: 'unsupported',
            summary: unsupportedSummary(),
            capabilities: [...CAPABILITY_BLURBS],
            examples: [...EXAMPLE_QUESTIONS],
          },
          // `unsupported` is a first-class ANSWER, not a failure — so no
          // fallback record unless classification itself failed upstream.
          fallback: null,
          resultCount: 0,
        };
    }
  }

  // ── stage 3: answer (no LLM) ──────────────────────────────────────────

  /** Deliberately trivial, and deliberately still a named stage: the day
   *  someone proposes "just let the model phrase the answer", this is the
   *  function they have to change, and the review catches it. */
  render(outcome: HandlerOutcome): ChatResult {
    return outcome.result;
  }

  // ── provider plumbing ─────────────────────────────────────────────────

  private async complete(system: string, user: string) {
    let lastError: unknown;

    // Transport retry policy: ONE retry on a transient network error or 5xx;
    // ZERO on 4xx — retrying a quota or auth failure only burns quota.
    for (let attempt = 0; attempt < 2; attempt++) {
      // A fresh budget per attempt: the retry is rare, and sharing one deadline
      // would make the second attempt fail instantly after a slow first one.
      const signal = AbortSignal.timeout(this.config.timeoutMs);
      try {
        return await this.llm.complete({
          system,
          user,
          json: { schema: intentJsonSchema },
          maxTokens: this.config.maxTokens,
          temperature: 0, // classification must be reproducible for eval to mean anything
          signal,
        });
      } catch (error) {
        lastError = error;
        const retryable = error instanceof LlmProviderError && error.retryable;
        if (!retryable || attempt === 1) break;
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
    throw lastError;
  }

  private log(
    input: ChatAsk,
    record: {
      intent: string | null;
      slots: Record<string, unknown> | null;
      fallbackRecord: ChatFallback | null;
      resultCount: number;
      llmMs: number;
      handlerMs: number;
      totalMs: number;
      inputTokens: number;
      outputTokens: number;
    },
  ): void {
    // ONE structured record per message, from the first working version.
    // `resultCount: 0` WITH `fallback.type = 'NO_RESULTS'` on a correctly
    // classified intent is the signature of slot-extraction failure — the most
    // common real-world problem, and invisible without both fields.
    //
    // Rendering is deliberately NOT timed: template concatenation is
    // sub-millisecond and will never be the cause of a latency regression, and a
    // field that always reads ~0 only teaches you to skim past fields. Overhead
    // is `totalMs` minus the other two.
    input.logger.info(
      {
        chat: {
          correlationId: input.correlationId,
          requestId: input.requestId,
          conversationId: input.conversationId,
          tenantId: getTenantId()?.toString() ?? null,
          userId: input.actor.id,
          question: input.question,
          intent: record.intent,
          slots: record.slots,
          fallback: record.fallbackRecord, // null on success — filterable, not inferred
          resultCount: record.resultCount,
          llmMs: record.llmMs,
          handlerMs: record.handlerMs,
          totalMs: record.totalMs,
          provider: this.llm.id,
          model: this.llm.model,
          promptVersion: PROMPT_VERSION,
          inputTokens: record.inputTokens,
          outputTokens: record.outputTokens,
        },
      },
      'chat message',
    );
  }
}

/**
 * Tolerant JSON extraction. Constrained decoding makes this path rare, but a
 * provider without it will happily wrap the object in ```json fences or a
 * sentence of preamble, and throwing that away is free.
 */
function parseJson(text: string): unknown {
  const withoutFences = text.replace(/```(?:json)?/gi, '').trim();
  const start = withoutFences.indexOf('{');
  const end = withoutFences.lastIndexOf('}');
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(withoutFences.slice(start, end + 1));
  } catch {
    return undefined;
  }
}
