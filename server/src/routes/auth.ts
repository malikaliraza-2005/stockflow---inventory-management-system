/**
 * `/auth` router — path + middleware chain + controller reference ONLY
 * (BEA §2). Chains follow the BEA §5 binding rows exactly:
 *
 *   POST /signup          Public · strict limiter · validate (SaaS tenant create)
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
  googleAuthSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
} from '../validation/schemas/auth.js';

export interface AuthRouterDeps {
  controller: ReturnType<typeof createAuthController>;
  authenticate: RequestHandler;
  strictLimiter: RequestHandler;
}

export function createAuthRouter(deps: AuthRouterDeps): Router {
  const { controller, authenticate, strictLimiter } = deps;
  const router = Router();

  // SaaS: public self-service tenant creation. Strict-limited like login (an
  // unauthenticated, resource-creating surface). No `authenticate` — signup
  // resolves nothing pre-existing; it opens a brand-new tenant.
  router.post('/signup', strictLimiter, validate(signupSchema), controller.signup);
  router.post('/login', strictLimiter, validate(loginSchema), controller.login);
  // Google sign-in (GIS ID-token). Public + strict-limited like login; the
  // service verifies the token and resolves-or-provisions the account.
  router.post('/google', strictLimiter, validate(googleAuthSchema), controller.googleAuth);
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
