/**
 * Error catalog constants — SRS §16.3 AS CODE (ERR §13), including the three
 * APR-01 documented extensions (05 §6.2 †). This is the CLOSED set of codes the
 * API may emit; each code is locked to exactly one HTTP status.
 *
 * Kept in lockstep with server/openapi.yaml's ErrorCode enum — a unit test
 * asserts set equality, so catalog and contract cannot drift apart.
 *
 * Evolution rule (ERR §13): a new code enters the SRS §16.3 catalog first
 * (change-controlled), then this module, then the client errorMap — never
 * ad-hoc in a service or controller.
 *
 * Client-only synthesized codes (E-1 NETWORK_ERROR, E-2 CHUNK_LOAD_ERROR) are
 * deliberately NOT here — they never cross the wire (ERR §12).
 */
export const ERROR_CATALOG = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  ACCOUNT_DEACTIVATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  DUPLICATE_SKU: 409,
  DUPLICATE_BARCODE: 409,
  DUPLICATE_EMAIL: 409,
  INSUFFICIENT_STOCK: 409,
  STALE_WRITE: 409,
  LAST_ADMIN: 409,
  PRODUCT_ARCHIVED: 409,
  PRODUCT_NOT_EMPTY: 409,
  PRODUCT_HAS_HISTORY: 409,
  CATEGORY_IN_USE: 409,
  INVALID_BARCODE: 422,
  IDEMPOTENCY_CONFLICT: 422,
  ACCOUNT_LOCKED: 423,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const satisfies Record<string, number>;

export type ErrorCode = keyof typeof ERROR_CATALOG;

export const ERROR_CODES = Object.keys(ERROR_CATALOG) as ErrorCode[];
