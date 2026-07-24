/**
 * Categories schema — VAL §5 "Categories", client mirror (F3 T-a). Mirrors
 * server/src/validation/schemas/categories.ts (create/update share this shape).
 * The query + delete schemas are server-side URL parsing (SMP §4 owns client
 * URL state) and are deliberately not mirrored.
 */
import { z } from 'zod';

export const categoryMessages = {
  name: 'Name: 2–60 characters',
  description: 'Description is too long (300 max)',
} as const;

const name = z
  .string(categoryMessages.name)
  .trim()
  .min(2, categoryMessages.name)
  .max(60, categoryMessages.name);

const description = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().max(300, categoryMessages.description).optional(),
);

/** POST/PATCH /categories — the CategoryFormModal shape. */
export const categoryWriteSchema = z.object({ name, description });

export type CategoryWriteInput = z.infer<typeof categoryWriteSchema>;
