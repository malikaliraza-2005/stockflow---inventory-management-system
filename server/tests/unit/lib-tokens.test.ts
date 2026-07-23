/**
 * F1 T-c — token utilities vs AAD §3 + the §11.4 adversarial class:
 * tampered-`alg` JWTs (including `none`) must be rejected (pinned HS256).
 */
import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';

import {
  durationToMs,
  generateOpaqueToken,
  hashToken,
  newFamilyId,
  signAccessToken,
  verifyAccessToken,
} from '../../src/lib/tokens.js';

const SECRET = 'unit-test-secret-of-sufficient-length!!';
const CLAIMS = { sub: '665f2b1a0000000000000001', role: 'ADMIN' } as const;

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

describe('access token (AAD §3.1)', () => {
  it('round-trips with payload EXACTLY {sub, role, iat, exp} — no PII', () => {
    const token = signAccessToken(CLAIMS, SECRET, '15m');
    const claims = verifyAccessToken(token, SECRET);
    expect(claims.sub).toBe(CLAIMS.sub);
    expect(claims.role).toBe('ADMIN');
    expect(claims.exp - claims.iat).toBe(900); // 15m
    expect(Object.keys(claims).sort()).toEqual(['exp', 'iat', 'role', 'sub']);
  });

  it('AAD §11.4: rejects alg=none (unsigned) tokens', () => {
    const header = base64url({ alg: 'none', typ: 'JWT' });
    const payload = base64url({ sub: CLAIMS.sub, role: 'ADMIN' });
    expect(() => verifyAccessToken(`${header}.${payload}.`, SECRET)).toThrow();
  });

  it('AAD §11.4: rejects a token signed with a DIFFERENT algorithm (same secret)', () => {
    const hs384 = jwt.sign({ sub: CLAIMS.sub, role: 'ADMIN' }, SECRET, {
      algorithm: 'HS384',
      expiresIn: 900,
    });
    expect(() => verifyAccessToken(hs384, SECRET)).toThrow(/invalid algorithm/);
  });

  it('rejects a token signed with the wrong secret', () => {
    const forged = jwt.sign(
      { sub: CLAIMS.sub, role: 'ADMIN' },
      'attacker-secret-attacker-secret!',
      {
        algorithm: 'HS256',
        expiresIn: 900,
      },
    );
    expect(() => verifyAccessToken(forged, SECRET)).toThrow(/invalid signature/);
  });

  it('rejects a token without a string sub claim', () => {
    const anonymous = jwt.sign({ role: 'ADMIN' }, SECRET, { algorithm: 'HS256', expiresIn: 900 });
    expect(() => verifyAccessToken(anonymous, SECRET)).toThrow();
  });

  it('EC-32: tolerates ≤ 30 s clock skew, rejects beyond it', () => {
    const skewed = jwt.sign({ sub: CLAIMS.sub, role: 'ADMIN' }, SECRET, {
      algorithm: 'HS256',
      expiresIn: -10, // expired 10 s ago — inside the leeway
    });
    expect(() => verifyAccessToken(skewed, SECRET)).not.toThrow();

    const expired = jwt.sign({ sub: CLAIMS.sub, role: 'ADMIN' }, SECRET, {
      algorithm: 'HS256',
      expiresIn: -60, // beyond the 30 s leeway
    });
    expect(() => verifyAccessToken(expired, SECRET)).toThrow(/expired/);
  });
});

describe('opaque tokens (AAD §3.2)', () => {
  it('are 256-bit CSPRNG values (43 base64url chars) and unique', () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();
    expect(a).toHaveLength(43); // 32 bytes → 43 chars base64url, no padding
    expect(a).not.toBe(b);
  });

  it('hash deterministically to the DBD §2.5 sha256-prefixed at-rest form', () => {
    const raw = generateOpaqueToken();
    expect(hashToken(raw)).toBe(hashToken(raw));
    expect(hashToken(raw)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(hashToken(raw)).not.toContain(raw); // raw never survives hashing
  });

  it('family ids are namespaced and unique', () => {
    expect(newFamilyId()).toMatch(/^fam_/);
    expect(newFamilyId()).not.toBe(newFamilyId());
  });
});

describe('durationToMs (SRS §18.4 TTL grammar)', () => {
  it.each([
    ['250ms', 250],
    ['900s', 900_000],
    ['15m', 900_000],
    ['2h', 7_200_000],
    ['7d', 604_800_000],
  ])('parses %s', (input, expected) => {
    expect(durationToMs(input)).toBe(expected);
  });

  it('rejects off-grammar values', () => {
    expect(() => durationToMs('15')).toThrow(/Invalid duration/);
    expect(() => durationToMs('1w')).toThrow(/Invalid duration/);
  });
});
