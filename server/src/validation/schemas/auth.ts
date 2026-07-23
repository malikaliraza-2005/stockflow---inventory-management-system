/**
 * Auth endpoint schemas — VAL §5 "Auth" rows, 1:1 (F1 T-a).
 *
 * Composition only: rules live in validation/primitives (VAL §11); this module
 * arranges them per endpoint. Two deliberate asymmetries (AAD §2):
 *
 *  - LOGIN password is non-empty only — the BR-32 policy is NEVER applied on
 *    the login form, so validation output cannot reveal it and failures stay
 *    generic (enumeration defense).
 *  - RESET/CHANGE apply the full `password` primitive to the NEW password —
 *    that is where policy enforcement lives.
 *
 * Unknown body fields are STRIPPED, never stored (VAL §2) — zod object default.
 * The client's `confirm` field is UX-only and dies here (VAL §4).
 *
 * MIRROR: client/src/lib/validation/schemas/auth.ts (VAL §11).
 */
import { z } from 'zod';

import { email, password } from '../primitives.js';

/** Auth-specific en-default strings (VAL §9 — clients key off code + field). */
export const authMessages = {
  passwordRequired: 'Enter your password',
  currentPasswordRequired: 'Enter your current password',
  tokenRequired: 'Reset link is invalid',
  newPasswordSame: 'New password must be different from your current password',
} as const;

/** POST /auth/login — §15.1. Generic constraints only; policy never revealed. */
export const loginSchema = z.object({
  email,
  // Non-empty, NEVER trimmed (a password is bytes, not text — VAL §2), no
  // length/character rules: those belong to the reset/change surface only.
  password: z.string(authMessages.passwordRequired).min(1, authMessages.passwordRequired),
});

/** POST /auth/reset-password — §15.7. Token validity itself is a service
 *  concern (401), not a schema concern (400) — the schema only rejects the
 *  structurally absent token. */
export const resetPasswordSchema = z.object({
  token: z.string(authMessages.tokenRequired).min(1, authMessages.tokenRequired),
  newPassword: password,
});

/** POST /auth/change-password — §15.7. `new ≠ current` is a cross-field rule
 *  (VAL §4); wrong current password is a service concern (401). */
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

export type LoginInput = z.infer<typeof loginSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
