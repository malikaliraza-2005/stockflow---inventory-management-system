/**
 * Users endpoint schemas — VAL §5 "Users" rows, client mirror (F2 T-a).
 * Mirrors create/update/me from server/src/validation/schemas/users.ts —
 * the list-query schema is server-side URL parsing (SMP §4 owns client URL
 * state) and is deliberately not mirrored.
 */
import { z } from 'zod';

import { email, password } from '../primitives';

export const USER_ROLES = ['ADMIN', 'STAFF'] as const;

export const userMessages = {
  name: 'Name: 2–80 characters',
  role: 'Invalid role',
  nothingToUpdate: 'Provide at least one field to update',
} as const;

const name = z
  .string(userMessages.name)
  .trim()
  .min(2, userMessages.name)
  .max(80, userMessages.name);
const role = z.enum(USER_ROLES, userMessages.role);

/** POST /users — §15.6 (Admin provisioning form, `UserFormModal`). */
export const userCreateSchema = z.object({
  name,
  email,
  role,
  temporaryPassword: password,
});

/** PATCH /users/:id — §15.6: name / role / isActive, nothing else. */
export const userUpdateSchema = z
  .object({
    name: name.optional(),
    role: role.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: userMessages.nothingToUpdate,
    path: ['(body)'],
  });

/** PATCH /users/me — Profile page name edit. */
export const meUpdateSchema = z.object({ name });

export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
export type MeUpdateInput = z.infer<typeof meUpdateSchema>;
