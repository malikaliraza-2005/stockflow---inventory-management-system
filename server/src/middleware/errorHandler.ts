/**
 * Terminal error handler shell (ERR §3) — the ONLY failure-response writer.
 *
 * 1. known AppError → its envelope + locked status
 * 2. unknown error  → logged server-side (stack stays here) + opaque
 *    INTERNAL_ERROR (SEC-12)
 * 3. correlation ID always attached (res.locals.correlationId — populated by
 *    task 0.10's correlation middleware; 'unknown' until a request passes it)
 * 4. status + JSON — nothing else writes failure responses
 *
 * Logger is injected: pino arrives with task 0.10; the console fallback keeps
 * this module consumer-free until then. Mounted LAST in the chain (BEA §2).
 */
import type { ErrorRequestHandler } from 'express';

import { AppError, InternalError, ServiceUnavailableError } from '../errors/AppError.js';

export type ErrorLogger = (message: string, meta: Record<string, unknown>) => void;

const consoleLogger: ErrorLogger = (message, meta) => {
  // Replaced by the pino correlation child in task 0.10 — never in tests.
  console.error(message, meta);
};

export function createErrorHandler(log: ErrorLogger = consoleLogger): ErrorRequestHandler {
  return (err: unknown, _req, res, next) => {
    // Express contract: if headers are gone, delegate to the default handler.
    if (res.headersSent) {
      next(err);
      return;
    }

    const correlationId =
      typeof res.locals['correlationId'] === 'string' ? res.locals['correlationId'] : 'unknown';

    let responseError: AppError;
    if (err instanceof AppError) {
      responseError = err;
    } else {
      // Unknown = a bug or an untranslated third-party error. Full detail
      // stays server-side; the wire gets the opaque envelope (SEC-12).
      log('unhandled error reached terminal handler', { correlationId, err });
      responseError = new InternalError();
    }

    if (responseError instanceof ServiceUnavailableError) {
      res.setHeader('Retry-After', String(responseError.retryAfterSeconds));
    }

    res.status(responseError.status).json(responseError.toEnvelope(correlationId));
  };
}
