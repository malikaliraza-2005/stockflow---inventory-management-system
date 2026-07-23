/**
 * Express app factory — the BEA §3 normative pipeline ("deviations are
 * defects"). Phase-0 slice: positions #0 (health), #1 (requestId), the
 * completion logger, the unknown-route 404, and the terminal errorHandler.
 * Positions #3–#8 (helmet, cors, compression, limiters, json+cookies,
 * mongoSanitize) and #9–#11 (authenticate, authorize, validate) arrive with
 * their consumers (0.12 header verification / Phase-1 auth) — slots reserved.
 *
 * Dependency-injected (logger, readiness) so integration tests run the real
 * app with no environment or database.
 */
import express, { type Express } from 'express';

import { NotFoundError, ServiceUnavailableError } from './errors/AppError.js';
import type { Logger } from './lib/logger.js';
import { createErrorHandler } from './middleware/errorHandler.js';
import { httpLogger } from './middleware/httpLogger.js';
import { requestId } from './middleware/requestId.js';

export interface AppDeps {
  logger: Logger;
  /** Readiness provider — server.ts owns the state (DB connected + integrity). */
  isReady: () => boolean;
  /** ARB-01: exact platform hop count (env TRUST_PROXY_HOPS); echo-verified in 0.12 (R-4). */
  trustProxyHops?: number;
  /** Seconds advertised in Retry-After while not ready (NFR-20). */
  readyRetryAfterSeconds?: number;
}

export function createApp(deps: AppDeps): Express {
  const { logger, isReady, trustProxyHops = 0, readyRetryAfterSeconds = 30 } = deps;

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxyHops);

  // #0 — health endpoints mounted BEFORE everything: no auth, no limiters,
  // no correlation (ARB-04; ERR §4 — monitoring bodies, not the app).
  // Shapes are contract-locked to server/openapi.yaml (task 0.5).
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/ready', (_req, res, next) => {
    if (isReady()) {
      res.json({ status: 'ready' });
      return;
    }
    // 503 envelope via the terminal handler; correlationId is 'unknown' here
    // by design — health mounts ahead of the requestId middleware.
    next(new ServiceUnavailableError(readyRetryAfterSeconds, 'Service not ready.'));
  });

  // #1 — correlation ID · completion logging
  app.use(requestId(logger));
  app.use(httpLogger());

  // Unknown route → 404 envelope (ERR §11)
  app.use((_req, _res, next) => {
    next(new NotFoundError());
  });

  // ∞ — terminal errorHandler: the only failure-response writer (ERR §3)
  app.use(
    createErrorHandler((message, meta) => {
      logger.error(meta, message);
    }),
  );

  return app;
}
