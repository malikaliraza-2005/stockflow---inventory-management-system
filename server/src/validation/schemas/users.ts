/**
 * Users endpoint schemas — VAL §5 "Users" rows / §3.1 (F2 T-a).
 *
 * Server-managed fields (mustChangePassword, failedLoginCount, lockedUntil,
 * reset-token fields, lastLoginAt) are NOT in any schema — zod's default
 * unknown-key stripping rejects-by-removal (VAL §3.1 "rejected if present"
 * resolves to stripped-before-storage, the §2 normalization rule).
 *
 * Field-name note: 05 §7.2 names the provisioning credential
 * `temporaryPassword` (the wire contract); VAL §5's shorthand row says
 * `password`. The endpoint spec is the API source of truth — wire name wins.
 *
 * MIRROR: client/src/lib/validation/schemas/users.ts (create/update/me only —
 * the query schema is server-side URL-param parsing, SMP §4 owns client URL state).
 */
import { z } from 'zod';

import { USER_ROLES } from '../../models/User.js';
import { email, password } from '../primitives.js';

export const userMessages = {
  name: 'Name: 2–80 characters',
  role: 'Invalid role',
  search: 'Search is too long (120 max)',
  nothingToUpdate: 'Provide at least one field to update',
} as const;

const name = z
  .string(userMessages.name)
  .trim()
  .min(2, userMessages.name)
  .max(80, userMessages.name);
const role = z.enum(USER_ROLES, userMessages.role);

/** POST /users — §15.6 (BR-31: Admin provisioning; forced change is server-set). */
export const userCreateSchema = z.object({
  name,
  email,
  role,
  temporaryPassword: password, // BR-32 applies to provisioned credentials too
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

/** PATCH /users/me — `{ name }` only (05 §7.2: role/status/email unreachable here). */
export const meUpdateSchema = z.object({ name });

/** GET /users query — §15.9 pagination preamble + §7.2 filters/sort. */
export const usersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20), // NFR-10 hard cap
  role: role.optional(),
  isActive: z
    .preprocess((value) => {
      if (value === 'true') return true;
      if (value === 'false') return false;
      return value; // anything else fails the boolean check below
    }, z.boolean())
    .optional(),
  search: z
    .preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().trim().max(120, userMessages.search).optional(),
    )
    .optional(),
  sort: z.enum(['name', 'email', 'createdAt', 'lastLoginAt']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
export type MeUpdateInput = z.infer<typeof meUpdateSchema>;
export type UsersQuery = z.infer<typeof usersQuerySchema>;
