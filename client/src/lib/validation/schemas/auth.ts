/**
 * Auth endpoint schemas — VAL §5 "Auth" rows, client mirror (F1 T-a).
 *
 * MIRROR: server/src/validation/schemas/auth.ts — one rule changed = both
 * files change; the twin vector suites keep the mirror honest (VAL §11).
 *
 * The confirm-password match is client-UX ONLY (VAL §4): pages compose it via
 * `withConfirm(...)` below; the server strips the field and validates
 * `newPassword` alone — the mirror stays exact, the UX stays helpful.
 */
import { z } from 'zod';

import { COMMON_PASSWORDS } from '../commonPasswords';
import { email, password } from '../primitives';

/**
 * Signup password — SAME BR-32 rules as the shared `password` primitive, but
 * each rule carries its OWN message so the signup form tells the user exactly
 * what to fix (the shared primitive intentionally collapses them into one
 * generic line, which is right for login but unhelpful when choosing a
 * password). MIRROR: server/src/validation/schemas/auth.ts `signupPassword`.
 */
export const signupPassword = z
  .string('Enter a password')
  .min(10, 'Password must be at least 10 characters long')
  .max(64, 'Password must be 64 characters or fewer')
  .regex(/[A-Za-z]/, 'Password must include at least one letter')
  .regex(/\d/, 'Password must include at least one number')
  .refine(
    (value) => !COMMON_PASSWORDS.has(value.toLowerCase()),
    'That password is too common — please choose something less predictable',
  );

/** Auth-specific en-default strings (VAL §9 — clients key off code + field). */
export const authMessages = {
  passwordRequired: 'Enter your password',
  currentPasswordRequired: 'Enter your current password',
  tokenRequired: 'Reset link is invalid',
  newPasswordSame: 'New password must be different from your current password',
  confirmMismatch: 'Passwords do not match',
} as const;

/**
 * POST /auth/signup (SaaS) — public self-service tenant creation. Unlike login,
 * the password DOES apply the full policy here (the account's first password).
 * MIRROR: server/src/validation/schemas/auth.ts.
 */
export const signupSchema = z.object({
  organizationName: z
    .string('Enter your organization name')
    .trim()
    .min(2, 'Organization name must be at least 2 characters')
    .max(120, 'Organization name must be 120 characters or fewer'),
  name: z
    .string('Enter your name')
    .trim()
    .min(2, 'Your name must be at least 2 characters')
    .max(80, 'Your name must be 80 characters or fewer'),
  email,
  password: signupPassword,
});

/** POST /auth/login — §15.1. Generic constraints only; policy never revealed. */
export const loginSchema = z.object({
  email,
  // Non-empty, NEVER trimmed, no policy rules — enumeration defense (AAD §2).
  password: z.string(authMessages.passwordRequired).min(1, authMessages.passwordRequired),
});

/** POST /auth/reset-password — §15.7 (token validity is the server's 401). */
export const resetPasswordSchema = z.object({
  token: z.string(authMessages.tokenRequired).min(1, authMessages.tokenRequired),
  newPassword: password,
});

/** POST /auth/change-password — §15.7 with the `new ≠ current` cross-field rule. */
export const changePasswordSchema = z
  .object({
    currentPassword: z
      .string(authMessages.currentPasswordRequired)
      .min(1, authMessages.currentPasswordRequired),
    newPassword: password,
  })
  .refine((body) => body.newPassword !== body.currentPassword, {
    message: authMessages.newPasswordSame,
    path: ['newPassword'],
  });

/**
 * Client-UX confirmation wrapper (VAL §7 on-blur "confirmation match") — adds
 * `confirmPassword` to any schema carrying `newPassword`. Never sent to the
 * server as a validation dependency: the API call submits the base fields.
 */
export function withConfirm<T extends z.ZodType<{ newPassword: string }>>(schema: T) {
  return z
    .object({ confirmPassword: z.string() })
    .and(schema)
    .refine((body) => body.confirmPassword === body.newPassword, {
      message: authMessages.confirmMismatch,
      path: ['confirmPassword'],
    });
}

/** POST /auth/google — the GIS ID-token; verified server-side (google-auth-library).
 *  MIRROR: server/src/validation/schemas/auth.ts. */
export const googleAuthSchema = z.object({
  idToken: z.string('Missing Google credential').min(1, 'Missing Google credential'),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type GoogleAuthInput = z.infer<typeof googleAuthSchema>;
