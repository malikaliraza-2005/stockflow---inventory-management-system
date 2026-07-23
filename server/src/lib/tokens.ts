/**
 * Token utilities — AAD §3, 1:1 (F1 T-c).
 *
 *  - Access token: JWT HS256, payload EXACTLY {sub, role, iat, exp} — no PII
 *    (SEC-01). The algorithm is PINNED AT VERIFICATION (AAD Issue 4): any
 *    other `alg`, including `none`, is rejected. ≤ 30 s clock-skew leeway
 *    (EC-32).
 *  - Opaque tokens (refresh sessions, reset links): ≥ 256-bit CSPRNG values —
 *    NOT JWTs. Only their SHA-256 hash is ever stored; the raw value exists
 *    exclusively in the cookie / reset link.
 *
 * Everything here is pure — no model or environment access; AuthService
 * composes these with storage.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import jwt from 'jsonwebtoken';

import type { UserRole } from '../models/User.js';

export interface AccessTokenClaims {
  sub: string;
  role: UserRole;
  iat: number;
  exp: number;
}

/** `15m`, `7d`, `900s`, `250ms` — the SRS §18.4 TTL grammar (config/env.ts). */
const DURATION_PATTERN = /^(\d+)(ms|s|m|h|d)$/;
const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function durationToMs(duration: string): number {
  const match = DURATION_PATTERN.exec(duration);
  const unit = match?.[2];
  if (!match || !unit) {
    throw new Error(`Invalid duration "${duration}" — expected e.g. 15m, 7d, 900s`);
  }
  return Number(match[1]) * (UNIT_MS[unit] ?? 0);
}

/** Sign the 15-minute claim (AAD §3.1). Payload is closed: {sub, role} + iat/exp. */
export function signAccessToken(
  claims: Pick<AccessTokenClaims, 'sub' | 'role'>,
  secret: string,
  ttl: string,
): string {
  return jwt.sign({ sub: claims.sub, role: claims.role }, secret, {
    algorithm: 'HS256',
    expiresIn: durationToMs(ttl) / 1000,
  });
}

/**
 * Verify with the algorithm PINNED (AAD Issue 4) and ≤ 30 s skew (EC-32).
 * Throws on any invalid/tampered/expired token — callers translate to the
 * generic 401. The returned role is a DISPLAY HINT only (AAD §1): every
 * authorization decision uses the live DB record.
 */
export function verifyAccessToken(token: string, secret: string): AccessTokenClaims {
  const payload = jwt.verify(token, secret, {
    algorithms: ['HS256'], // pinned — `none` and RS/ES confusion rejected
    clockTolerance: 30,
  });
  if (typeof payload === 'string' || typeof payload.sub !== 'string') {
    throw new jwt.JsonWebTokenError('malformed payload');
  }
  return payload as unknown as AccessTokenClaims;
}

/** ≥ 256-bit CSPRNG opaque value (AAD §3.2) — refresh sessions & reset links. */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

/** The ONLY form an opaque token takes at rest (DBD §2.5 `sha256:` prefix). */
export function hashToken(raw: string): string {
  return `sha256:${createHash('sha256').update(raw).digest('hex')}`;
}

/** Rotation family — reuse of any rotated member revokes the family (BR-35). */
export function newFamilyId(): string {
  return `fam_${randomUUID()}`;
}
