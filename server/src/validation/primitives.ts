/**
 * Global validation primitives — VAL-IMS-014 §2, implemented 1:1.
 *
 * The shared vocabulary of the whole system (VAL §1): every endpoint schema
 * (T-a tasks, VAL §5) COMPOSES these — no endpoint redefines a rule. Messages
 * are the exact user-natural strings from the §2 table (the en-default set).
 *
 * Normalization order (VAL §2, global): trim → case rule → blank-to-absent →
 * boundary type-coercion (API layer only — z.coerce belongs in endpoint
 * schemas, never here) → validation.
 *
 * MIRROR: client/src/lib/validation/primitives.ts (VAL §11) — one primitive
 * changed = both files change; the twin Appendix-A vector suites keep the
 * mirror honest.
 *
 * Rule of evolution (VAL §11): a new rule enters the SPEC first, then this
 * module, then schemas — never ad-hoc in a controller or component.
 */
import { z } from 'zod';

import { COMMON_PASSWORDS } from './commonPasswords.js';

/** §11: exported message table — single source for the en-default strings. */
export const validationMessages = {
  email: 'Enter a valid email address',
  password: 'Password must be 10–64 characters with a letter and a number',
  sku: 'SKU: 3–32 letters, numbers, hyphens',
  barcodeUnreadable: "Code can't be read",
  barcodeTooLong: 'Barcode too long',
  money: 'Enter a valid amount',
  quantityInt: 'Enter a whole number',
  movementQty: 'Quantity must be 1–100,000',
  objectId: 'Invalid reference',
  isoDate: 'Enter a valid date',
  noteText: 'Note is too long (500 max)',
  cloudinaryPublicId: 'Invalid image reference',
  cloudinaryUrl: 'Invalid image URL',
} as const;

/** RFC-shape, ≤ 254 · trim → lowercase */
export const email = z
  .string(validationMessages.email)
  .trim()
  .toLowerCase()
  .pipe(z.email(validationMessages.email).max(254, validationMessages.email));

/**
 * BR-32 + VAL review Issue 2: 10–64 chars (bcrypt truncates at 72 bytes — the
 * 64 cap keeps any UTF-8 input safely inside), ≥ 1 letter, ≥ 1 digit, not in
 * the common-password deny-list. NEVER trimmed.
 */
export const password = z
  .string(validationMessages.password)
  .min(10, validationMessages.password)
  .max(64, validationMessages.password)
  .regex(/[A-Za-z]/, validationMessages.password)
  .regex(/\d/, validationMessages.password)
  .refine((value) => !COMMON_PASSWORDS.has(value.toLowerCase()), validationMessages.password);

/** BR-02: trim → uppercase, then `^[A-Z0-9-]{3,32}$` */
export const sku = z
  .string(validationMessages.sku)
  .trim()
  .toUpperCase()
  .pipe(z.string().regex(/^[A-Z0-9-]{3,32}$/, validationMessages.sku));

/**
 * BR-05/16: printable, ≤ 64, trimmed. Blank→absent is NOT here — wrap with
 * `sparseOptional(barcode)` at the schema (PDV-04).
 */
export const barcode = z
  .string(validationMessages.barcodeUnreadable)
  .trim()
  .pipe(
    z
      .string()
      .max(64, validationMessages.barcodeTooLong)
      .regex(/^[\x20-\x7E]+$/, validationMessages.barcodeUnreadable),
  );

/**
 * Decimal STRING (wire form, DBD §7) ≥ 0, ≤ 2 dp, ≤ 9,999,999.99 (defensive
 * bound — VAL Issue 3, logged assumption VA-1, overridable).
 */
export const money = z
  .string(validationMessages.money)
  .trim()
  .pipe(
    z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, validationMessages.money)
      .refine((value) => Number(value) <= 9_999_999.99, validationMessages.money),
  );

/** BR-10: integer 0…10,000,000. Boundary string-coercion is the API layer's job. */
export const quantityInt = z
  .number(validationMessages.quantityInt)
  .int(validationMessages.quantityInt)
  .min(0, validationMessages.quantityInt)
  .max(10_000_000, validationMessages.quantityInt);

/** BR-12: integer 1…100,000 */
export const movementQty = z
  .number(validationMessages.movementQty)
  .int(validationMessages.movementQty)
  .min(1, validationMessages.movementQty)
  .max(100_000, validationMessages.movementQty);

/** 24-hex Mongo ObjectId reference */
export const objectId = z
  .string(validationMessages.objectId)
  .regex(/^[0-9a-fA-F]{24}$/, validationMessages.objectId);

const ISO_DATE_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/;

/** ISO-8601, valid calendar date (2026-02-30 must fail, not roll over). */
export const isoDate = z
  .string(validationMessages.isoDate)
  .regex(ISO_DATE_PATTERN, validationMessages.isoDate)
  .refine((value) => {
    const match = ISO_DATE_PATTERN.exec(value);
    if (!match) return false;
    const [, year, month, day] = match;
    const y = Number(year);
    const m = Number(month);
    const d = Number(day);
    if (m < 1 || m > 12) return false;
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    if (d < 1 || d > daysInMonth) return false;
    return !Number.isNaN(new Date(value).getTime());
  }, validationMessages.isoDate);

/** RFC 4122, any version (APR-07) — idempotency keys (BR-20). Server-only failure. */
export const uuid = z.uuid();

/** ≤ 500, trimmed */
export const noteText = z
  .string(validationMessages.noteText)
  .trim()
  .pipe(z.string().max(500, validationMessages.noteText));

/** VAL Issue 4: folder-scoped — anchors reject traversal (`../ims/prod/x`). */
export const cloudinaryPublicId = z
  .string(validationMessages.cloudinaryPublicId)
  .regex(/^ims\/prod\/[A-Za-z0-9_/-]+$/, validationMessages.cloudinaryPublicId);

/**
 * VAL Issue 4: HTTPS + host pinned to the CONFIGURED Cloudinary delivery host —
 * a factory because the host is environment configuration, not a constant.
 */
export function cloudinaryUrl(deliveryHost: string) {
  return z.url(validationMessages.cloudinaryUrl).refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.host === deliveryHost;
    } catch {
      return false;
    }
  }, validationMessages.cloudinaryUrl);
}

/**
 * PDV-04: blank → ABSENT for sparse-unique-indexed fields (barcode,
 * reset-token, idempotency-key class) — an empty string must never reach a
 * sparse index.
 */
export function sparseOptional<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    schema.optional(),
  );
}
