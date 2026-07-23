/**
 * Pipeline #9 — `authenticate` (BEA §3, AAD §5.1).
 *
 *   verify JWT (pinned HS256, sig + exp, ≤ 30 s skew)
 *     → load user by _id (indexed point-read — inside the NFR-01 budget)
 *     → isActive false?         → 401 ACCOUNT_DEACTIVATED (within one request)
 *     → mustChangePassword set? → only change-password / logout / refresh
 *                                 allowed (AAD §2, review Issue 2) — enforced
 *                                 HERE because the user record is already
 *                                 loaded (zero extra cost)
 *
 * The token's role claim is NEVER used for authorization — `req.user` carries
 * the live DB record and `authorize` reads role from it (FR-AUTH-07, EC-17).
 */
import type { RequestHandler } from 'express';

import { AccountDeactivatedError, ForbiddenError, UnauthorizedError } from '../errors/AppError.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { verifyAccessToken } from '../lib/tokens.js';
import { User } from '../models/User.js';

/** The EXACT allowed set for a mustChangePassword session (AAD §2). */
const FORCED_CHANGE_ALLOWED = new Set([
  '/api/v1/auth/change-password',
  '/api/v1/auth/logout',
  '/api/v1/auth/refresh',
]);

export function authenticate(accessSecret: string): RequestHandler {
  return asyncHandler(async (req, _res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedError();

    let sub: string;
    try {
      sub = verifyAccessToken(header.slice('Bearer '.length), accessSecret).sub;
    } catch {
      throw new UnauthorizedError(); // tampered/expired/forged — all the same 401
    }

    const user = await User.findById(sub);
    if (!user) throw new UnauthorizedError();
    if (!user.isActive) throw new AccountDeactivatedError(); // EC-17: immediate

    if (user.mustChangePassword) {
      const fullPath = (req.baseUrl + req.path).replace(/\/+$/, '');
      if (!FORCED_CHANGE_ALLOWED.has(fullPath)) {
        // Distinct reason (AAD §2) — the client's FEV-02 gate keys off it.
        throw new ForbiddenError('Password change required before continuing.');
      }
    }

    req.user = user;
    next();
  });
}
