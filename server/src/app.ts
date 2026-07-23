/**
 * Express app factory — the BEA §3 normative pipeline ("deviations are
 * defects"), completed to position #11 with F1:
 *
 *   #0 health · #1 requestId (+completion log) · #2 trust proxy ·
 *   #3 helmet · #4 cors (credentials only on /auth) · #5 compression ·
 *   #6 rate limiters (global /api/v1; strict on login+reset inside the auth
 *   router) · #7 json(1 MB)+cookies · #8 mongoSanitize ·
 *   #9 authenticate / #10 authorize / #11 validate (per-route) ·
 *   ∞ errorHandler
 *
 * Dependency-injected (logger, readiness, env subset) so integration tests
 * run the REAL pipeline against ephemeral Mongo with test configuration.
 */
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import mongoSanitize from 'express-mongo-sanitize';
import helmet from 'helmet';

import { createAuthController } from './controllers/authController.js';
import { createUsersController } from './controllers/usersController.js';
import { NotFoundError, ServiceUnavailableError } from './errors/AppError.js';
import type { Logger } from './lib/logger.js';
import { authenticate } from './middleware/authenticate.js';
import { createAuthorize } from './middleware/authorize.js';
import { createErrorHandler } from './middleware/errorHandler.js';
import { httpLogger } from './middleware/httpLogger.js';
import { createGlobalLimiter, createStrictLimiter } from './middleware/rateLimiters.js';
import { requestId } from './middleware/requestId.js';
import { createAuthRouter } from './routes/auth.js';
import { createUsersRouter } from './routes/users.js';
import { AuditService } from './services/AuditService.js';
import { AuthService } from './services/AuthService.js';
import { UserService } from './services/UserService.js';

/** The env slice the pipeline consumes — server.ts passes the validated Env. */
export interface AppEnv {
  NODE_ENV: 'development' | 'test' | 'staging' | 'production';
  JWT_ACCESS_SECRET: string;
  ACCESS_TOKEN_TTL: string;
  REFRESH_TOKEN_TTL: string;
  CORS_ORIGIN: string;
  RATE_LIMIT_GLOBAL_MAX: number;
  RATE_LIMIT_GLOBAL_WINDOW_MS: number;
  RATE_LIMIT_STRICT_MAX: number;
  RATE_LIMIT_STRICT_WINDOW_MS: number;
}

export interface AppDeps {
  logger: Logger;
  /** Readiness provider — server.ts owns the state (DB connected + integrity). */
  isReady: () => boolean;
  env: AppEnv;
  /** ARB-01: exact platform hop count (env TRUST_PROXY_HOPS); echo-verified in 0.12 (R-4). */
  trustProxyHops?: number;
  /** Seconds advertised in Retry-After while not ready (NFR-20). */
  readyRetryAfterSeconds?: number;
}

export function createApp(deps: AppDeps): Express {
  const { logger, isReady, env, trustProxyHops = 0, readyRetryAfterSeconds = 30 } = deps;

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxyHops); // #2 (ARB-01)

  // #0 — health endpoints mounted BEFORE everything: no auth, no limiters,
  // no correlation (ARB-04; ERR §4 — monitoring bodies, not the app).
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/ready', (_req, res, next) => {
    if (isReady()) {
      res.json({ status: 'ready' });
      return;
    }
    next(new ServiceUnavailableError(readyRetryAfterSeconds, 'Service not ready.'));
  });

  // #1 — correlation ID · completion logging
  app.use(requestId(logger));
  app.use(httpLogger());

  // #3 — helmet: CSP (self + Cloudinary image origin), HSTS, frame-deny,
  // referrer policy (SEC-05)
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { 'img-src': ["'self'", 'https://res.cloudinary.com'] },
      },
    }),
  );

  // #4 — cors: exact frontend origin; credentials ONLY on /auth routes
  // (BEA §3 — the refresh cookie is the sole credentialed exchange)
  app.use(
    cors((req, callback) => {
      callback(null, {
        origin: env.CORS_ORIGIN,
        credentials: req.path.startsWith('/api/v1/auth'),
      });
    }),
  );

  // #5 — compression (NFR-07)
  app.use(compression());

  // #6 — global limiter on the API surface (SEC-04); strict limiter is wired
  // inside the auth router on login + reset-password only
  app.use(
    '/api/v1',
    createGlobalLimiter({
      windowMs: env.RATE_LIMIT_GLOBAL_WINDOW_MS,
      max: env.RATE_LIMIT_GLOBAL_MAX,
    }),
  );

  // #7 — body parsing (1 MB cap, SEC-06) + refresh cookie
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // #8 — strip $-prefixed keys/operators (SEC-06)
  app.use(mongoSanitize());

  // ── services + per-route chain builders (#9/#10/#11 live on routes) ────
  const audit = new AuditService(logger);
  const authService = new AuthService({
    audit,
    logger,
    config: {
      accessSecret: env.JWT_ACCESS_SECRET,
      accessTtl: env.ACCESS_TOKEN_TTL,
      refreshTtl: env.REFRESH_TOKEN_TTL,
    },
  });
  const authenticateMw = authenticate(env.JWT_ACCESS_SECRET);
  // App-scoped authorize: ONE BEV-03 denial window per instance (F2 — its
  // first consumer, the /users router).
  const authorize = createAuthorize({ audit });
  const userService = new UserService({
    audit,
    authService,
    clientOrigin: env.CORS_ORIGIN, // reset links point at the frontend (AS-6)
  });

  app.use(
    '/api/v1/auth',
    createAuthRouter({
      controller: createAuthController({
        authService,
        secureCookies: env.NODE_ENV === 'production' || env.NODE_ENV === 'staging',
      }),
      authenticate: authenticateMw,
      strictLimiter: createStrictLimiter({
        windowMs: env.RATE_LIMIT_STRICT_WINDOW_MS,
        max: env.RATE_LIMIT_STRICT_MAX,
      }),
    }),
  );

  app.use(
    '/api/v1/users',
    createUsersRouter({
      controller: createUsersController(userService),
      authenticate: authenticateMw,
      authorize,
    }),
  );

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
