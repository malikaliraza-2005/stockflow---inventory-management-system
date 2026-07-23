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
