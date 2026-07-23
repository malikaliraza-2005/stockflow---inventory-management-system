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
