/**
 * F1 T-a — client mirror of server/tests/unit/validation-auth.test.ts
 * (VAL §11: twin suites keep the mirror honest), plus the client-only
 * `withConfirm` UX wrapper.
 */
import { describe, expect, it } from 'vitest';

import {
  changePasswordSchema,
  loginSchema,
  resetPasswordSchema,
  withConfirm,
} from '../../src/lib/validation/schemas/auth';

const VALID_PASSWORD = 'correct-h0rse-battery';

describe('loginSchema (mirror — policy never revealed)', () => {
  it('accepts valid credentials and normalizes the email', () => {
    const parsed = loginSchema.parse({ email: '  Admin@Example.COM ', password: 'x' });
    expect(parsed.email).toBe('admin@example.com');
    expect(parsed.password).toBe('x');
  });

  it('does NOT apply the BR-32 policy at login', () => {
    expect(loginSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
  });

  it('never trims the password', () => {
    expect(loginSchema.parse({ email: 'a@b.co', password: '  spaced  ' }).password).toBe(
      '  spaced  ',
    );
  });

  it('rejects a malformed email and an empty password', () => {
    expect(loginSchema.safeParse({ email: 'not-an-email', password: 'x' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
  });
});

describe('resetPasswordSchema (mirror)', () => {
  it('accepts a token + policy-compliant password', () => {
    expect(
      resetPasswordSchema.safeParse({ token: 'abc', newPassword: VALID_PASSWORD }).success,
    ).toBe(true);
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

  it('rejects an empty token', () => {
    expect(resetPasswordSchema.safeParse({ token: '', newPassword: VALID_PASSWORD }).success).toBe(
      false,
    );
  });
});

describe('changePasswordSchema (mirror — cross-field rules)', () => {
  it('rejects new === current', () => {
    expect(
      changePasswordSchema.safeParse({
        currentPassword: VALID_PASSWORD,
        newPassword: VALID_PASSWORD,
      }).success,
    ).toBe(false);
  });

  it('policy applies to NEW only — legacy short current password parses', () => {
    expect(
      changePasswordSchema.safeParse({ currentPassword: 'x', newPassword: VALID_PASSWORD }).success,
    ).toBe(true);
  });
});

describe('withConfirm (client-UX only — VAL §7 confirmation match)', () => {
  const schema = withConfirm(changePasswordSchema);

  it('accepts a matching confirmation', () => {
    expect(
      schema.safeParse({
        currentPassword: 'x',
        newPassword: VALID_PASSWORD,
        confirmPassword: VALID_PASSWORD,
      }).success,
    ).toBe(true);
  });

  it('rejects a mismatch, anchored to the confirm field', () => {
    const result = schema.safeParse({
      currentPassword: 'x',
      newPassword: VALID_PASSWORD,
      confirmPassword: 'different-pw-9',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['confirmPassword']);
    }
  });
});
