/**
 * Pipeline #6 — rate limiters (SEC-04, BEA §3).
 *
 *  - Global: 300 req / 15 min / IP across /api/v1.
 *  - Strict: 10 / 15 min / IP on POST /auth/login + /auth/reset-password.
 *
 * PER-INSTANCE in-memory stores — an accepted ≈ N× nominal at N instances
 * (AAD §6): the DB-backed lockout (BR-33) remains the GLOBAL authority.
 * Per-IP attribution depends on the exact trust-proxy hop count (ARB-01 —
 * verified per environment, R-4).
 *
 * Failures flow through the terminal handler (RATE_LIMITED envelope) — the
 * limiter never writes its own response shape.
 */
import { rateLimit, type RateLimitRequestHandler } from 'express-rate-limit';

import { RateLimitedError } from '../errors/AppError.js';

export interface RateLimitConfig {
  windowMs: number;
  max: number;
}

function makeLimiter(config: RateLimitConfig): RateLimitRequestHandler {
  return rateLimit({
    windowMs: config.windowMs,
    limit: config.max,
    standardHeaders: true, // RateLimit-* headers — clients can back off honestly
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(new RateLimitedError());
    },
  });
}

export const createGlobalLimiter = makeLimiter;
export const createStrictLimiter = makeLimiter;
