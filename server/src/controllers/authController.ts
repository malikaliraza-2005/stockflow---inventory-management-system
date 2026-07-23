/**
 * Auth controllers — HTTP concerns ONLY (BEA §2): extract validated input,
 * call ONE AuthService method, shape the response via serializers. Zero
 * business logic.
 *
 * Cookie contract (AAD §3.2 / 05 §3): the refresh token travels EXCLUSIVELY
 * as `httpOnly · Secure · SameSite=Strict` scoped to /api/v1/auth — Strict
 * scoping also neutralizes CSRF on the refresh route. `Secure` is disabled
 * only outside staging/production (local http dev).
 */
import type { CookieOptions, Request, RequestHandler, Response } from 'express';

import { asyncHandler } from '../lib/asyncHandler.js';
import { hashToken } from '../lib/tokens.js';
import { serializeSessionUser } from '../serializers/user.js';
import type { AuthService, AuthSession } from '../services/AuthService.js';
import type {
  ChangePasswordInput,
  LoginInput,
  ResetPasswordInput,
} from '../validation/schemas/auth.js';

export const REFRESH_COOKIE = 'refreshToken';
const COOKIE_PATH = '/api/v1/auth';

export interface AuthControllerDeps {
  authService: AuthService;
  /** false only for local http development — staging/production always true. */
  secureCookies: boolean;
}

export function createAuthController(deps: AuthControllerDeps) {
  const { authService, secureCookies } = deps;

  function cookieOptions(expires?: Date): CookieOptions {
    return {
      httpOnly: true,
      secure: secureCookies,
      sameSite: 'strict',
      path: COOKIE_PATH,
      ...(expires ? { expires } : {}),
    };
  }

  function sendSession(res: Response, session: AuthSession): void {
    res.cookie(REFRESH_COOKIE, session.refreshToken, cookieOptions(session.refreshExpiresAt));
    res.json({
      accessToken: session.accessToken,
      user: serializeSessionUser(session.user),
      settings: session.settings, // FCM-01 — display constants, both roles
    });
  }

  function requestContext(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  const login: RequestHandler = asyncHandler(async (req, res) => {
    const { email, password } = req.body as LoginInput;
    const session = await authService.login(email, password, requestContext(req));
    sendSession(res, session);
  });

  const refresh: RequestHandler = asyncHandler(async (req, res) => {
    const raw = (req.cookies as Record<string, string | undefined>)[REFRESH_COOKIE];
    const session = await authService.refresh(raw, requestContext(req));
    sendSession(res, session);
  });

  const logout: RequestHandler = asyncHandler(async (req, res) => {
    const raw = (req.cookies as Record<string, string | undefined>)[REFRESH_COOKIE];
    await authService.logout(raw);
    res.clearCookie(REFRESH_COOKIE, cookieOptions());
    res.status(204).end();
  });

  const resetPassword: RequestHandler = asyncHandler(async (req, res) => {
    const { token, newPassword } = req.body as ResetPasswordInput;
    await authService.completeReset(token, newPassword, requestContext(req));
    res.status(204).end();
  });

  const changePassword: RequestHandler = asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body as ChangePasswordInput;
    const raw = (req.cookies as Record<string, string | undefined>)[REFRESH_COOKIE];
    // req.user is set — the route carries `authenticate` ahead of this.
    await authService.changePassword(req.user!._id, currentPassword, newPassword, {
      currentTokenHash: raw ? hashToken(raw) : undefined,
      ip: req.ip,
    });
    res.status(204).end();
  });

  return { login, refresh, logout, resetPassword, changePassword };
}
