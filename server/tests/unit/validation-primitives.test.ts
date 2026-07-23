/**
 * VAL-IMS-014 Appendix A — boundary-value vectors for the §2 primitives,
 * "derived mechanically" (the spec's copy-down exercise). NFR-26 unit tier,
 * merge-blocking (TST §2).
 *
 * Entity-level Appendix rows (user name, category name, date-range, limit,
 * range) belong to their endpoint schemas — they arrive with each feature's
 * T-a task, not here.
 *
 * TWIN: client/tests/unit/validation-primitives.test.ts runs the same vectors
 * against the client mirror — parity is enforced by tests, not discipline.
 */
import { describe, expect, it } from 'vitest';

import {
  barcode,
  cloudinaryPublicId,
  cloudinaryUrl,
  email,
  isoDate,
  money,
  movementQty,
  noteText,
  objectId,
  password,
  quantityInt,
  sku,
  sparseOptional,
  uuid,
  validationMessages,
} from '../../src/validation/primitives.js';

describe('email', () => {
  it('normalizes trim → lowercase', () => {
    expect(email.parse('  Admin@Example.COM  ')).toBe('admin@example.com');
  });
  it('rejects non-RFC shapes', () => {
    expect(email.safeParse('not-an-email').success).toBe(false);
    expect(email.safeParse('a@b').success).toBe(false);
  });
  it('rejects > 254 chars', () => {
    expect(email.safeParse(`${'a'.repeat(250)}@example.com`).success).toBe(false);
  });
});

describe('password (BR-32, 10–64, letter + digit, deny-list, never trimmed)', () => {
  it('invalid low: 9 chars / no digit / no letter / deny-list entry', () => {
    expect(password.safeParse('abcdefg12').success).toBe(false); // 9 chars
    expect(password.safeParse('abcdefghij').success).toBe(false); // no digit
    expect(password.safeParse('1234567890').success).toBe(false); // no letter
    expect(password.safeParse('password123').success).toBe(false); // deny-list
    expect(password.safeParse('PASSWORD123').success).toBe(false); // deny-list, case-insensitive
  });
  it('valid min 10 / valid max 64', () => {
    expect(password.safeParse('abcdefghi1').success).toBe(true); // 10
    expect(password.safeParse(`${'a'.repeat(63)}1`).success).toBe(true); // 64
  });
  it('invalid high: 65 chars', () => {
    expect(password.safeParse(`${'a'.repeat(64)}1`).success).toBe(false);
  });
  it('is never trimmed — surrounding spaces are part of the password', () => {
    expect(password.parse('  abcdef123  ')).toBe('  abcdef123  ');
  });
  it('emits the exact spec message', () => {
    const result = password.safeParse('short1');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(validationMessages.password);
    }
  });
});

describe('sku (BR-02, normalize then ^[A-Z0-9-]{3,32}$)', () => {
  it('invalid low: 2 chars · illegal char', () => {
    expect(sku.safeParse('AB').success).toBe(false);
    expect(sku.safeParse('ab#1').success).toBe(false);
  });
  it('valid min 3 / valid max 32', () => {
    expect(sku.safeParse('ABC').success).toBe(true);
    expect(sku.safeParse('A'.repeat(32)).success).toBe(true);
  });
  it('invalid high: 33 chars', () => {
    expect(sku.safeParse('A'.repeat(33)).success).toBe(false);
  });
  it('normalization pair: " abc-1 " → "ABC-1"', () => {
    expect(sku.parse(' abc-1 ')).toBe('ABC-1');
  });
});

describe('barcode (printable, ≤ 64, trimmed)', () => {
  it('valid: 1 char and 64 chars', () => {
    expect(barcode.safeParse('8').success).toBe(true);
    expect(barcode.safeParse('8'.repeat(64)).success).toBe(true);
  });
  it('invalid high: 65 chars → "Barcode too long"', () => {
    const result = barcode.safeParse('8'.repeat(65));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(validationMessages.barcodeTooLong);
    }
  });
  it('invalid: non-printable → "Code can\'t be read"', () => {
    const result = barcode.safeParse('8412345');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(validationMessages.barcodeUnreadable);
    }
  });
  it('normalization pair: trimmed', () => {
    expect(barcode.parse(' 8412345678 ')).toBe('8412345678');
  });
});

describe('money (decimal string, ≥ 0, ≤ 2 dp, ≤ 9,999,999.99 — VA-1)', () => {
  it('invalid: -0.01 · 1.234 (3 dp) · abc', () => {
    expect(money.safeParse('-0.01').success).toBe(false);
    expect(money.safeParse('1.234').success).toBe(false);
    expect(money.safeParse('abc').success).toBe(false);
  });
  it('valid min: "0" and "0.00"', () => {
    expect(money.safeParse('0').success).toBe(true);
    expect(money.safeParse('0.00').success).toBe(true);
  });
  it('valid max 9999999.99 / invalid high 10000000.00', () => {
    expect(money.safeParse('9999999.99').success).toBe(true);
    expect(money.safeParse('10000000.00').success).toBe(false);
  });
  it('normalization pair: " 5.99 " → "5.99"', () => {
    expect(money.parse(' 5.99 ')).toBe('5.99');
  });
});

describe('quantityInt (BR-10, 0…10,000,000)', () => {
  it('invalid: -1 · 1.5', () => {
    expect(quantityInt.safeParse(-1).success).toBe(false);
    expect(quantityInt.safeParse(1.5).success).toBe(false);
  });
  it('valid bounds: 0 and 10,000,000', () => {
    expect(quantityInt.safeParse(0).success).toBe(true);
    expect(quantityInt.safeParse(10_000_000).success).toBe(true);
  });
  it('invalid high: 10,000,001', () => {
    expect(quantityInt.safeParse(10_000_001).success).toBe(false);
  });
});

describe('movementQty (BR-12, 1…100,000)', () => {
  it('invalid low: 0', () => {
    expect(movementQty.safeParse(0).success).toBe(false);
  });
  it('valid bounds: 1 and 100,000', () => {
    expect(movementQty.safeParse(1).success).toBe(true);
    expect(movementQty.safeParse(100_000).success).toBe(true);
  });
  it('invalid high: 100,001', () => {
    expect(movementQty.safeParse(100_001).success).toBe(false);
  });
});

describe('objectId (24-hex)', () => {
  it('accepts 24 hex chars, either case', () => {
    expect(objectId.safeParse('665f2b1a9c3d4e5f6a7b8c9d').success).toBe(true);
    expect(objectId.safeParse('665F2B1A9C3D4E5F6A7B8C9D').success).toBe(true);
  });
  it('rejects wrong length and non-hex', () => {
    expect(objectId.safeParse('665f2b1a9c3d4e5f6a7b8c9').success).toBe(false); // 23
    expect(objectId.safeParse('665f2b1a9c3d4e5f6a7b8czz').success).toBe(false);
  });
});

describe('isoDate (ISO-8601, valid calendar date)', () => {
  it('accepts date and datetime forms', () => {
    expect(isoDate.safeParse('2026-07-23').success).toBe(true);
    expect(isoDate.safeParse('2026-07-23T14:03:11.000Z').success).toBe(true);
  });
  it('rejects impossible calendar dates (no rollover)', () => {
    expect(isoDate.safeParse('2026-02-30').success).toBe(false);
    expect(isoDate.safeParse('2026-13-01').success).toBe(false);
  });
  it('rejects non-ISO strings', () => {
    expect(isoDate.safeParse('23/07/2026').success).toBe(false);
    expect(isoDate.safeParse('not-a-date').success).toBe(false);
  });
});

describe('uuid (RFC 4122, any version — APR-07)', () => {
  it('accepts v4 and v1', () => {
    expect(uuid.safeParse('9b2b6c8a-3f4d-4e5f-8a7b-1c2d3e4f5a6b').success).toBe(true);
    expect(uuid.safeParse('2f1a0e70-68d1-11ec-90d6-0242ac120003').success).toBe(true);
  });
  it('rejects malformed keys', () => {
    expect(uuid.safeParse('not-a-uuid').success).toBe(false);
    expect(uuid.safeParse('9b2b6c8a3f4d4e5f8a7b1c2d3e4f5a6b').success).toBe(false);
  });
});

describe('noteText (≤ 500, trimmed)', () => {
  it('accepts 500 after trim; rejects 501', () => {
    expect(noteText.safeParse('n'.repeat(500)).success).toBe(true);
    expect(noteText.safeParse('n'.repeat(501)).success).toBe(false);
  });
});

describe('cloudinaryPublicId (folder-scoped — VAL Issue 4)', () => {
  it('accepts ims/prod/…', () => {
    expect(cloudinaryPublicId.safeParse('ims/prod/a').success).toBe(true);
  });
  it('rejects out-of-folder and traversal', () => {
    expect(cloudinaryPublicId.safeParse('evil/x').success).toBe(false);
    expect(cloudinaryPublicId.safeParse('../ims/prod/x').success).toBe(false);
  });
});

describe('cloudinaryUrl (HTTPS, host-pinned — VAL Issue 4)', () => {
  const schema = cloudinaryUrl('res.cloudinary.com');
  it('accepts HTTPS on the configured host', () => {
    expect(schema.safeParse('https://res.cloudinary.com/ims/image/upload/x.jpg').success).toBe(
      true,
    );
  });
  it('rejects other hosts and non-HTTPS', () => {
    expect(schema.safeParse('https://evil.example.com/x.jpg').success).toBe(false);
    expect(schema.safeParse('http://res.cloudinary.com/x.jpg').success).toBe(false);
  });
});

describe('sparseOptional (PDV-04 blank → absent)', () => {
  const schema = sparseOptional(barcode);
  it('maps "" and whitespace to absent — never into a sparse index', () => {
    expect(schema.parse('')).toBeUndefined();
    expect(schema.parse('   ')).toBeUndefined();
  });
  it('passes real values through unchanged', () => {
    expect(schema.parse(' 8412345678 ')).toBe('8412345678');
  });
  it('still rejects invalid non-blank values', () => {
    expect(schema.safeParse('8'.repeat(65)).success).toBe(false);
  });
});
