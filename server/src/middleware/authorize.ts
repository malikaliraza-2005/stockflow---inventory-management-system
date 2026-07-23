/**
 * Pipeline #10 — `authorize(...roles)` (BEA §3, AAD §5).
 *
 * Role comes from the LIVE record `authenticate` loaded — never the token
 * claim (EC-17: demotion takes effect within one request). Route annotations
 * derive from the SRS §5 permission matrix — the single authority shared with
 * the frontend's generated `usePermission` matrix (FD-3; generation lands
 * with F2, the matrix's first multi-role consumer).
 *
 * BEV-03: ≥ 5 role-denials per user per 15 min emits ONE security event per
 * window, fire-and-forget. The counter is per-instance in-memory — the event
 * is a smoke signal for the audit trail, not an enforcement mechanism (the
 * 403s themselves are the enforcement).
 */
import type { RequestHandler } from 'express';

import { ForbiddenError, UnauthorizedError } from '../errors/AppError.js';
import type { UserRole } from '../models/User.js';
import type { AuditService } from '../services/AuditService.js';

const DENIAL_WINDOW_MS = 15 * 60_000;
const DENIAL_THRESHOLD = 5;

interface DenialWindow {
  windowStart: number;
  count: number;
  reported: boolean;
}

export interface AuthorizeDeps {
  audit: AuditService;
  now?: () => Date;
}

export function createAuthorize(deps: AuthorizeDeps) {
  const denials = new Map<string, DenialWindow>();
  const now = deps.now ?? (() => new Date());

  function registerDenial(userId: string, email: string, ip: string | undefined): void {
    const at = now().getTime();
    let window = denials.get(userId);
    if (!window || at - window.windowStart >= DENIAL_WINDOW_MS) {
      window = { windowStart: at, count: 0, reported: false };
      denials.set(userId, window);
    }
    window.count += 1;
    if (window.count >= DENIAL_THRESHOLD && !window.reported) {
      window.reported = true; // ONE event per window (BEV-03)
      void deps.audit.securityEvent({
        actorId: userId,
        entityType: 'SECURITY',
        entityId: userId,
        action: 'REPEATED_FORBIDDEN',
        entityLabel: email,
        ip,
      });
    }
  }

  return function authorize(...roles: UserRole[]): RequestHandler {
    return (req, _res, next) => {
      const user = req.user;
      if (!user) {
        // Chain misuse — authorize without authenticate is a wiring defect.
        next(new UnauthorizedError());
        return;
      }
      if (!roles.includes(user.role)) {
        registerDenial(user._id.toString(), user.email, req.ip);
        next(new ForbiddenError());
        return;
      }
      next();
    };
  };
}
