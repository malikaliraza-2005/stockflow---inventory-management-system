/**
 * Categories endpoint schemas — VAL §5 "Categories" rows (F3 T-a); DBD §2.2
 * field constraints (name 2–60, description ≤ 300).
 *
 * `isSystem` is SERVER-SET, never client-writable (VAL §5 / BR-28): it appears
 * in NO request schema, so zod's unknown-key stripping drops any client attempt
 * before it reaches the service.
 *
 * Name uniqueness is CASE-INSENSITIVE via the collation index (DBD §2.2), not a
 * schema concern — the unique index is the authority (APR-08): a duplicate maps
 * to VALIDATION_ERROR, NOT a 409 (no SRS §16.3 409 mandate exists for category
 * names, unlike SKU/email). CategoryService owns that mapping.
 *
 * MIRROR: client/src/lib/validation/schemas/categories.ts (create/update only —
 * the query + delete schemas are server-side URL-param parsing; SMP §4 owns
 * client URL state). The mirror ships with the F3 frontend task (T-f/g).
 */
import { z } from 'zod';

import { objectId } from '../primitives.js';

export const categoryMessages = {
  name: 'Name: 2–60 characters',
  description: 'Description is too long (300 max)',
  reassignTo: 'Invalid reference',
} as const;

const name = z
  .string(categoryMessages.name)
  .trim()
  .min(2, categoryMessages.name)
  .max(60, categoryMessages.name);

/** Blank → absent (VAL §2): an omitted or whitespace-only description is unset,
 * never stored as an empty string. */
const description = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().max(300, categoryMessages.description).optional(),
);

/** POST /categories — §15.3 (BR-26). PATCH shares the shape (both fields are the
 * only editable surface; PATCH replaces them — an omitted description unsets). */
export const categoryCreateSchema = z.object({ name, description });
export const categoryUpdateSchema = z.object({ name, description });

/** GET /categories query — §7.4 pagination + `withCounts` (§9.9); sort name|createdAt. */
export const categoriesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20), // NFR-10 hard cap
  withCounts: z
    .preprocess((value) => {
      if (value === 'true') return true;
      if (value === 'false' || value === undefined) return false;
      return value; // anything else fails the boolean check below
    }, z.boolean())
    .default(false),
  sort: z.enum(['name', 'createdAt']).default('name'),
  order: z.enum(['asc', 'desc']).default('asc'),
});

/** DELETE /categories/:id query — optional reassignment target (BR-27). Absence,
 * self-reference, and non-existence are dispositioned in CategoryService (the
 * 409-vs-400 branch depends on whether references actually exist). */
export const categoryDeleteQuerySchema = z.object({
  reassignTo: objectId.optional(),
});

export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>;
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>;
export type CategoriesQuery = z.infer<typeof categoriesQuerySchema>;
export type CategoryDeleteQuery = z.infer<typeof categoryDeleteQuerySchema>;
