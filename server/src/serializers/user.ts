/**
 * User serialization — the wire contract slice for auth (05 §2 / DBD §7).
 *
 * Structural exclusion (BR-32, SEC-02): these functions BUILD the output
 * object field-by-field — `passwordHash`, reset-token fields, and lockout
 * internals cannot leak because they are never read. `_id` → `id` string;
 * dates → ISO-8601 UTC.
 */
import type { HydratedDocument } from 'mongoose';

import type { UserDoc } from '../models/User.js';

/** The 05 §7.1 session `user` block (login/refresh 200). */
export interface SessionUserPayload {
  id: string;
  name: string;
  email: string;
  role: UserDoc['role'];
  mustChangePassword: boolean;
}

export function serializeSessionUser(user: HydratedDocument<UserDoc>): SessionUserPayload {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  };
}

/** The 05 §7.2 admin-facing user row (list + detail — no credential fields). */
export interface UserPayload {
  id: string;
  name: string;
  email: string;
  role: UserDoc['role'];
  isActive: boolean;
  lastLoginAt?: string;
  createdAt: string;
}

export function serializeUser(user: HydratedDocument<UserDoc>): UserPayload {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    // Optional-sparse rule (05 §2): absent, never null
    ...(user.lastLoginAt ? { lastLoginAt: user.lastLoginAt.toISOString() } : {}),
    createdAt: user.createdAt.toISOString(),
  };
}

/** The 05 §7.2 own-profile shape (GET/PATCH /users/me). */
export interface OwnProfilePayload {
  id: string;
  name: string;
  email: string;
  role: UserDoc['role'];
  mustChangePassword: boolean;
  lastLoginAt?: string;
}

export function serializeOwnProfile(user: HydratedDocument<UserDoc>): OwnProfilePayload {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
    ...(user.lastLoginAt ? { lastLoginAt: user.lastLoginAt.toISOString() } : {}),
  };
}
