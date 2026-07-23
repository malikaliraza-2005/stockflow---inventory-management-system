/**
 * AppError skeleton — the typed-error spine (ERR §3).
 *
 * Services/middleware THROW these; controllers never catch (except to translate
 * third-party errors into typed AppErrors); exactly one terminal middleware
 * (middleware/errorHandler) serializes them to the §4 envelope.
 *
 * Target architecture is one subclass per catalog code, constructor-locked to
 * its status. Per the first-consumer law (IMP-020) each subclass arrives with
 * the feature that throws it (T-i tasks); Phase 0 ships the base plus the
 * three codes Phase 0 itself consumes.
 */
import { ERROR_CATALOG, type ErrorCode } from './catalog.js';

/** The 05 §6.1 / ERR §4 wire envelope. */
export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    correlationId: string;
  };
}

export class AppError extends Error {
  readonly code: ErrorCode;
  /** HTTP status — locked to the code via the catalog; never constructor-chosen. */
  readonly status: number;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = ERROR_CATALOG[code];
    this.details = details;
  }

  /** The ONLY shape an AppError takes on the wire (ERR §3.4). */
  toEnvelope(correlationId: string): ErrorEnvelope {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined ? { details: this.details } : {}),
        correlationId,
      },
    };
  }
}

/** Unknown id / unknown route / dead URL (ERR §2). */
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found.') {
    super('NOT_FOUND', message);
  }
}

/**
 * The generic 401 (F1). Login/reset failures MUST stay generic (AAD §2 —
 * never "wrong password" vs "no such user"); also the auth middleware's
 * missing/invalid-token response.
 */
export class UnauthorizedError extends AppError {
  constructor(message = 'Invalid credentials.') {
    super('UNAUTHORIZED', message);
  }
}

/** One field failure inside a 400 envelope (VAL §9 details[]). */
export interface FieldIssue {
  field: string;
  message: string;
}

/** Schema-layer rejection (05 §6.1) — details is ALWAYS the field list (F1). */
export class ValidationError extends AppError {
  constructor(details: FieldIssue[], message = 'Validation failed.') {
    super('VALIDATION_ERROR', message, details);
  }
}

/** Role gate denial (§5 matrix) and the mustChangePassword fence (AAD §2) (F1). */
export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action.') {
    super('FORBIDDEN', message);
  }
}

/** SEC-04 limiters — per-IP, per-instance (F1). */
export class RateLimitedError extends AppError {
  constructor(message = 'Too many requests. Please try again later.') {
    super('RATE_LIMITED', message);
  }
}

/** BR-33: 5 consecutive failures → 15-min lock → 423 (F1). */
export class AccountLockedError extends AppError {
  constructor(message = 'Account temporarily locked. Try again later.') {
    super('ACCOUNT_LOCKED', message);
  }
}

/** FR-USER-04 / EC-17: deactivation takes effect within one request (F1). */
export class AccountDeactivatedError extends AppError {
  constructor(message = 'This account has been deactivated.') {
    super('ACCOUNT_DEACTIVATED', message);
  }
}

/** SRS §12.2 mandated 409 — unique-index-backed, race-safe (APR-01 †) (F2). */
export class DuplicateEmailError extends AppError {
  constructor(message = 'Email already in use.') {
    super('DUPLICATE_EMAIL', message);
  }
}

/** BR-30: the last active Admin is unviolable — T6 atomic guard (F2). */
export class LastAdminError extends AppError {
  constructor(message = 'Cannot remove the last active Admin.') {
    super('LAST_ADMIN', message);
  }
}

/** DB down / booting / draining — carries Retry-After (NFR-20, DEP §5). */
export class ServiceUnavailableError extends AppError {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds = 30, message = 'Service temporarily unavailable.') {
    super('SERVICE_UNAVAILABLE', message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * The opaque 500 (SEC-12): fixed message, correlation ID only — internals
 * never leave the server. The terminal handler substitutes this for any
 * non-AppError that reaches it.
 */
export class InternalError extends AppError {
  constructor() {
    super('INTERNAL_ERROR', 'Something went wrong. Please try again with the reference ID.');
  }
}
