/**
 * `users` — DBD §2.1, 1:1. Accounts are permanent (deactivated, never
 * deleted — BR-29) so attribution resolves forever.
 *
 * `passwordHash` is `select: false`: excluded from every query by default —
 * auth code must opt in with `.select('+passwordHash')`.
 * Second validation layer (DBD §5): models/jsonValidators.ts, applied at the
 * seed release phase.
 */
import { model, Schema } from 'mongoose';

export const USER_ROLES = ['ADMIN', 'STAFF'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface UserDoc {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
  mustChangePassword: boolean;
  failedLoginCount: number;
  lockedUntil?: Date;
  resetTokenHash?: string;
  resetTokenExpiresAt?: Date;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDoc>(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    email: { type: String, required: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, required: true, enum: USER_ROLES },
    isActive: { type: Boolean, required: true, default: true },
    mustChangePassword: { type: Boolean, required: true, default: true },
    failedLoginCount: { type: Number, required: true, default: 0 },
    lockedUntil: { type: Date },
    resetTokenHash: { type: String }, // PDV-04: blank never stored — absent instead
    resetTokenExpiresAt: { type: Date },
    lastLoginAt: { type: Date },
  },
  { timestamps: true },
);

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ role: 1, isActive: 1 }); // atomic last-admin count (BR-30)
userSchema.index({ resetTokenHash: 1 }, { sparse: true }); // reset-flow lookup (DBR-04)

export const User = model<UserDoc>('User', userSchema);
