/**
 * Correlation-ID middleware — pipeline position #1 (BEA §3, NFR-23).
 *
 * Honors a well-formed inbound X-Correlation-Id (so a trace can span retries
 * and the frontend interceptor), otherwise generates one. The ID goes to:
 *  - the response header (05 §1: every response carries it)
 *  - res.locals (read by the terminal errorHandler for envelopes)
 *  - a pino child logger on req.log (every log line carries it)
 *
 * crypto.randomUUID is RFC 4122 v4 — SRS §17.2 names the `uuid` package, which
 * predates the Node-22 baseline; the built-in is behaviorally identical.
 */
import { randomUUID } from 'node:crypto';

import type { RequestHandler } from 'express';

import type { Logger } from '../lib/logger.js';

export const CORRELATION_HEADER = 'X-Correlation-Id';

/** printable ASCII, bounded — rejects log-injection and header abuse */
const INBOUND_ID_PATTERN = /^[\x21-\x7E]{1,128}$/;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      correlationId: string;
      log: Logger;
    }
  }
}

export function requestId(baseLogger: Logger): RequestHandler {
  return (req, res, next) => {
    const inbound = req.header(CORRELATION_HEADER);
    const correlationId =
      inbound !== undefined && INBOUND_ID_PATTERN.test(inbound) ? inbound : randomUUID();

    req.correlationId = correlationId;
    req.log = baseLogger.child({ correlationId });
    res.locals['correlationId'] = correlationId;
    res.setHeader(CORRELATION_HEADER, correlationId);
    next();
  };
}
