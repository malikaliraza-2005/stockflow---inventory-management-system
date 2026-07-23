/**
 * List-envelope helpers — the 05 §5 contract every list endpoint obeys:
 * `{ data, page, limit, totalItems, totalPages }` (FR-SRCH-03). Limits are
 * already schema-capped at 100 (NFR-10) before reaching here.
 */

export interface ListEnvelope<T> {
  data: T[];
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
}

export function listEnvelope<T>(
  data: T[],
  page: number,
  limit: number,
  totalItems: number,
): ListEnvelope<T> {
  return { data, page, limit, totalItems, totalPages: Math.ceil(totalItems / limit) };
}

/** User-supplied search text → literal regex fragment (no metacharacters). */
export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
