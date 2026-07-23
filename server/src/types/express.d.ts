/**
 * Request augmentation — `req.user` is the LIVE user record loaded by the
 * `authenticate` middleware on every request (FR-AUTH-07: token claims are
 * informational; the DB record is the authority).
 */
import type { HydratedDocument } from 'mongoose';

import type { UserDoc } from '../models/User.js';

declare global {
  namespace Express {
    interface Request {
      user?: HydratedDocument<UserDoc>;
    }
  }
}

export {};
