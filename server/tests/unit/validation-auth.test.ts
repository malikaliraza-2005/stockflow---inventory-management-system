/**
 * F1 T-a — auth endpoint schemas vs their VAL §5 rows + Appendix-A password
 * vectors at the composition point (the primitive itself is vector-tested in
 * validation-primitives.test.ts; here we prove each schema APPLIES or
 * deliberately OMITS it).
 */
import { describe, expect, it } from 'vitest';

import {
  changePasswordSchema,
  loginSchema,
  resetPasswordSchema,
} from '../../src/validation/schemas/auth.js';

const VALID_PASSWORD = 'correct-h0rse-battery'; // 10–64, letter+digit, not denied

describe('loginSchema (§15.1 — policy never revealed)', () => {
  it('accepts valid credentials and normalizes the email', () => {
    const parsed = loginSchema.parse({ email: '  Admin@Example.COM ', password: 'x' });
    expect(parsed.email).toBe('admin@example.com');
    expect(parsed.password).toBe('x');
  });

  it('does NOT apply the BR-32 policy — a short legacy password must reach bcrypt', () => {
    // AAD §2: login validation output must not reveal the policy. "x" fails
    // every policy rule yet must parse — rejection is the service's generic 401.
    expect(loginSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
  });

  it('never trims the password (VAL §2 — never trimmed)', () => {
    const parsed = loginSchema.parse({ email: 'a@b.co', password: '  spaced  ' });
    expect(parsed.password).toBe('  spaced  ');
  });

  it('rejects a malformed email and an empty password', () => {
    expect(loginSchema.safeParse({ email: 'not-an-email', password: 'x' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
  });

  it('strips unknown fields (VAL §2 — stripped, never stored)', () => {
    const parsed = loginSchema.parse({ email: 'a@b.co', password: 'x', rememberMe: true });
    expect(parsed).not.toHaveProperty('rememberMe');
  });
});

describe('resetPasswordSchema (§15.7 — policy enforced on the NEW password)', () => {
  it('accepts a token + policy-compliant password', () => {
    expect(
      resetPasswordSchema.safeParse({ token: 'abc', newPassword: VALID_PASSWORD }).success,
    ).toBe(true);
  });

  it('rejects an empty token (400) — token VALIDITY is the service 401, not schema', () => {
    expect(resetPasswordSchema.safeParse({ token: '', newPassword: VALID_PASSWORD }).success).toBe(
      false,
    );
  });

  it.each([
    ['9 chars', 'shortpw12'],
    ['no digit', 'passwordonly'],
    ['no letter', '1234567890'],
    ['65 chars', `a1${'x'.repeat(63)}`],
    ['deny-list entry', 'password123'],
  ])('applies the BR-32 policy to newPassword — rejects %s', (_label, newPassword) => {
    expect(resetPasswordSchema.safeParse({ token: 'abc', newPassword }).success).toBe(false);
  });

  it('accepts the Appendix-A boundary lengths (10 and 64)', () => {
    expect(resetPasswordSchema.safeParse({ token: 't', newPassword: 'abcdefgh12' }).success).toBe(
      true,
    );
    expect(
      resetPasswordSchema.safeParse({ token: 't', newPassword: `a1${'x'.repeat(62)}` }).success,
    ).toBe(true);
  });
});

describe('changePasswordSchema (§15.7 + VAL §4 cross-field rules)', () => {
  it('accepts current + compliant new password', () => {
    expect(
      changePasswordSchema.safeParse({ currentPassword: 'old', newPassword: VALID_PASSWORD })
        .success,
    ).toBe(true);
  });

  it('rejects new === current (VAL §4: new ≠ current)', () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: VALID_PASSWORD,
      newPassword: VALID_PASSWORD,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['newPassword']);
    }
  });

  it('requires a non-empty current password but never applies policy to it', () => {
    expect(
      changePasswordSchema.safeParse({ currentPassword: '', newPassword: VALID_PASSWORD }).success,
    ).toBe(false);
    // current password may be a legacy short one — policy applies to NEW only
    expect(
      changePasswordSchema.safeParse({ currentPassword: 'x', newPassword: VALID_PASSWORD }).success,
    ).toBe(true);
  });

  it("strips the client's confirm field (VAL §4 — confirmation is client-UX only)", () => {
    const parsed = changePasswordSchema.parse({
      currentPassword: 'x',
      newPassword: VALID_PASSWORD,
      confirmPassword: 'mismatch-is-irrelevant-here-9',
    });
    expect(parsed).not.toHaveProperty('confirmPassword');
  });
});
