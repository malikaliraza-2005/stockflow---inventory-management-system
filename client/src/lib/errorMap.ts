/**
 * The ONE code→behavior + code→message table (ERR §5.1/§13) — no other module
 * maps error codes to UI. Codes come from the wire catalog (SRS §16.3 via the
 * generated types) plus the two client-synthesized codes that NEVER cross the
 * wire: E-1 NETWORK_ERROR and E-2 CHUNK_LOAD_ERROR (ERR §12).
 *
 * Behaviors (ERR §5.2):
 *  - 'inline'     → the owning form renders details[] via FormField
 *  - 'dialog'     → the owning dialog/page renders its designed WIR state
 *  - 'toast'      → toast via uiStore (errors persist until dismissed)
 *  - 'redirect'   → FORBIDDEN: notice toast + redirect '/' (EC-19)
 *  - 'endSession' → auth-terminal: persistent toast + endSession(reason)
 */

/** Wire codes (SRS §16.3 + APR-01 †) + client-only E-1/E-2. */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'ACCOUNT_DEACTIVATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'DUPLICATE_SKU'
  | 'DUPLICATE_BARCODE'
  | 'DUPLICATE_EMAIL'
  | 'INSUFFICIENT_STOCK'
  | 'STALE_WRITE'
  | 'LAST_ADMIN'
  | 'PRODUCT_ARCHIVED'
  | 'PRODUCT_NOT_EMPTY'
  | 'PRODUCT_HAS_HISTORY'
  | 'CATEGORY_IN_USE'
  | 'INVALID_BARCODE'
  | 'IDEMPOTENCY_CONFLICT'
  | 'ACCOUNT_LOCKED'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'NETWORK_ERROR' // E-1 — client-synthesized, never on the wire
  | 'CHUNK_LOAD_ERROR'; // E-2 — client-synthesized, never on the wire

export type ErrorBehavior = 'inline' | 'dialog' | 'toast' | 'redirect' | 'endSession';

interface ErrorRule {
  behavior: ErrorBehavior;
  /** en-default user message (VAL §9: codes are never shown to users). */
  message: string;
}

export const errorMap: Record<ErrorCode, ErrorRule> = {
  VALIDATION_ERROR: { behavior: 'inline', message: 'Please fix the highlighted fields.' },

  // 409-class conflicts — the owning dialog/page renders its WIR state
  DUPLICATE_SKU: { behavior: 'dialog', message: 'SKU already exists.' },
  DUPLICATE_BARCODE: { behavior: 'dialog', message: 'Barcode already assigned to a product.' },
  DUPLICATE_EMAIL: { behavior: 'dialog', message: 'Email already in use.' },
  INSUFFICIENT_STOCK: { behavior: 'dialog', message: 'Not enough stock available.' },
  STALE_WRITE: { behavior: 'dialog', message: 'Changed by someone else — reload to continue.' },
  LAST_ADMIN: { behavior: 'dialog', message: 'Cannot remove the last active Admin.' },
  PRODUCT_ARCHIVED: { behavior: 'dialog', message: 'This product is archived.' },
  PRODUCT_NOT_EMPTY: { behavior: 'dialog', message: 'Stock must be zero before archiving.' },
  PRODUCT_HAS_HISTORY: {
    behavior: 'dialog',
    message: 'This product has movement history and cannot be deleted.',
  },
  CATEGORY_IN_USE: { behavior: 'dialog', message: 'Category still has products assigned.' },
  INVALID_BARCODE: { behavior: 'dialog', message: "Code can't be read." },
  IDEMPOTENCY_CONFLICT: {
    behavior: 'dialog',
    message: 'A different request with the same key was already processed.',
  },
  ACCOUNT_LOCKED: {
    behavior: 'dialog', // login form renders its 423 state
    message: 'Account temporarily locked. Try again in about 15 minutes.',
  },

  FORBIDDEN: { behavior: 'redirect', message: "You don't have access to that." },
  NOT_FOUND: { behavior: 'toast', message: "That item couldn't be found." },
  RATE_LIMITED: { behavior: 'toast', message: 'Too many requests — wait a moment and retry.' },

  UNAUTHORIZED: { behavior: 'endSession', message: 'Your session has ended. Please sign in.' },
  ACCOUNT_DEACTIVATED: {
    behavior: 'endSession',
    message: 'This account has been deactivated.',
  },

  NETWORK_ERROR: { behavior: 'toast', message: 'Connection lost — check your network and retry.' },
  SERVICE_UNAVAILABLE: {
    behavior: 'toast',
    message: 'Service is temporarily unavailable — retrying shortly may help.',
  },
  INTERNAL_ERROR: {
    behavior: 'toast',
    message: 'Something went wrong. Please try again with the reference ID.',
  },
  CHUNK_LOAD_ERROR: {
    behavior: 'toast',
    message: 'The app updated — reloading this view.',
  },
};

/** Message lookup with a safe fallback for unknown codes (05 §1: clients tolerate unknowns). */
export function messageFor(code: string): string {
  return (errorMap as Record<string, ErrorRule>)[code]?.message ?? errorMap.INTERNAL_ERROR.message;
}

export function behaviorFor(code: string): ErrorBehavior {
  return (errorMap as Record<string, ErrorRule>)[code]?.behavior ?? 'toast';
}
