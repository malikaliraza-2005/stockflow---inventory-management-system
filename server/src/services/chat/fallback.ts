/**
 * The fallback ladder — how the assistant handles uncertainty.
 *
 * Every branch here is a DETERMINISTIC condition. None of them asks the model
 * how sure it is: self-reported LLM confidence is uncalibrated (0.95 on wrong
 * classifications, 0.6 on right ones), so a threshold on it manufactures false
 * accepts and false rejects in roughly equal measure while feeling principled.
 *
 * The types are NAMED, not numbered. `fallbackCase: 2` needs a lookup table that
 * lives in a document rather than in the log, and in six months nobody remembers
 * what 2 meant. A closed union also means adding a ninth case forces every
 * consumer — including the alert queries — to account for it.
 */

export const CHAT_FALLBACK_TYPES = [
  /** The completion isn't JSON. One reparse retry, then `unsupported`. */
  'JSON_PARSE_FAILED',
  /** zod rejected it — unknown intent, wrong type, invented slot. THE safety net. */
  'SCHEMA_VALIDATION_FAILED',
  /** A slot the handler requires is absent or empty → clarifying question. */
  'SLOT_MISSING',
  /** The handler ran and returned nothing → explicit no-match naming the search. */
  'NO_RESULTS',
  /** More rows than we show → count + top N + "narrow it down", never a silent cut. */
  'TOO_MANY_RESULTS',
  /** `movement_history` matched several products → list them, don't pick one. */
  'AMBIGUOUS_PRODUCT',
  /** The caller's role lacks the intent's capability. Checked BEFORE the handler. */
  'FORBIDDEN',
  /** Provider error, timeout or quota → 503, never a 500 and never a hang. */
  'PROVIDER_UNAVAILABLE',
] as const;

export type ChatFallbackType = (typeof CHAT_FALLBACK_TYPES)[number];

export interface ChatFallback {
  type: ChatFallbackType;
  /**
   * Machine-shaped diagnostics only — a zod issue code and path, a provider
   * status. NEVER free prose, and NEVER the user's question: that already has
   * its own log field, and duplicating it doubles the PII surface for nothing.
   */
  details?: string;
}

export function fallback(type: ChatFallbackType, details?: string): ChatFallback {
  return details === undefined ? { type } : { type, details };
}
