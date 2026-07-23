/**
 * `/auth` router — path + middleware chain + controller reference ONLY
 * (BEA §2). Chains follow the BEA §5 binding rows exactly:
 *
 *   POST /login           Public · strict limiter · validate(15.1)
 *   POST /refresh         Public (cookie) · no body schema
 *   POST /logout          Any   · authenticate (idempotent revoke)
 *   POST /reset-password  Public (token) · strict limiter · validate(15.7)
 *   POST /change-password Any   · authenticate · validate(15.7)
 *
 * No `authorize` on any row — every auth route is either Public or Any, and
 * mustChangePassword sessions are fenced inside `authenticate` (AAD §2).
 */
import { Router, type RequestHandler } from 'express';

import type { createAuthController } from '../controllers/authController.js';
import { validate } from '../middleware/validate.js';
import {
  changePasswordSchema,
  loginSchema,
  resetPasswordSchema,
} from '../validation/schemas/auth.js';

export interface AuthRouterDeps {
  controller: ReturnType<typeof createAuthController>;
  authenticate: RequestHandler;
  strictLimiter: RequestHandler;
}

export function createAuthRouter(deps: AuthRouterDeps): Router {
  const { controller, authenticate, strictLimiter } = deps;
  const router = Router();

  router.post('/login', strictLimiter, validate(loginSchema), controller.login);
  router.post('/refresh', controller.refresh);
  router.post('/logout', authenticate, controller.logout);
  router.post(
    '/reset-password',
    strictLimiter,
    validate(resetPasswordSchema),
    controller.resetPassword,
  );
  router.post(
    '/change-password',
    authenticate,
    validate(changePasswordSchema),
    controller.changePassword,
  );

  return router;
}
