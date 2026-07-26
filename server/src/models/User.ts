/**
 * `users` — DBD §2.1, 1:1. Accounts are permanent (deactivated, never
 * deleted — BR-29) so attribution resolves forever.
 *
 * `passwordHash` is `select: false`: excluded from every query by default —
 * auth code must opt in with `.select('+passwordHash')`.
 * Second validation layer (DBD §5): models/jsonValidators.ts, applied at the
 * seed release phase.
 */
import { model, Schema, type Types } from 'mongoose';

import { tenantScopePlugin } from './plugins/tenantScope.js';

export const USER_ROLES = ['ADMIN', 'STAFF'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** How the account authenticates. LOCAL = email + password (BR-32); GOOGLE =
 *  Google sign-in (no password). An account may be linked to Google while
 *  keeping a LOCAL password — `googleSub` presence is the real link signal. */
export const AUTH_PROVIDERS = ['LOCAL', 'GOOGLE'] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

export interface UserDoc {
  /** Owning tenant (SaaS). Added by the tenantScope plugin; declared here for types. */
  tenantId: Types.ObjectId;
  name: string;
  email: string;
  /** Optional: a Google-only account has no password (BR-32 applies to LOCAL). */
  passwordHash?: string;
  authProvider: AuthProvider;
  /** Google `sub` claim — present once the account is linked to Google. */
  googleSub?: string;
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
    passwordHash: { type: String, required: false, select: false },
    authProvider: { type: String, required: true, enum: AUTH_PROVIDERS, default: 'LOCAL' },
    googleSub: { type: String },
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

userSchema.plugin(tenantScopePlugin);

// Email is GLOBALLY unique (SaaS decision: one email = one account across all
// tenants) so login resolves the tenant from the account — NOT tenant-scoped.
userSchema.index({ email: 1 }, { unique: true });
// One Google identity = one account (sparse: LOCAL-only accounts have no sub).
userSchema.index({ googleSub: 1 }, { unique: true, sparse: true });
// Last-admin count (BR-30) is now PER-TENANT — tenant-leading.
userSchema.index({ tenantId: 1, role: 1, isActive: 1 });
userSchema.index({ tenantId: 1, createdAt: -1 }); // default tenant-scoped user list
userSchema.index({ resetTokenHash: 1 }, { sparse: true }); // reset-flow lookup (DBR-04) — global, pre-context

export const User = model<UserDoc>('User', userSchema);
