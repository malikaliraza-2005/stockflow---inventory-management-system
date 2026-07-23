/**
 * `refreshTokens` — DBD §2.5, 1:1. The server-side session store enabling
 * rotation, revocation, and reuse detection (BR-35, AAD §3.2).
 *
 * Only the SHA-256 HASH of the opaque token is stored — the raw value exists
 * exclusively in the httpOnly cookie. Rotated rows are RETAINED (rotatedAt
 * set, row kept): that retention is what makes reuse detectable.
 *
 * PDV-03: the TTL index is garbage collection ONLY — validity is always
 * checked against `expiresAt` / `rotatedAt` / `revokedAt` VALUES at use time.
 * No `updatedAt`: DBD §2.5 defines none (rotation stamps explicit fields).
 */
import { model, Schema, type Types } from 'mongoose';

export interface RefreshTokenDoc {
  userId: Types.ObjectId;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  rotatedAt?: Date;
  revokedAt?: Date;
  ip?: string;
  userAgent?: string;
  createdAt: Date;
}

const refreshTokenSchema = new Schema<RefreshTokenDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true },
    familyId: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    rotatedAt: { type: Date },
    revokedAt: { type: Date },
    ip: { type: String },
    userAgent: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

refreshTokenSchema.index({ tokenHash: 1 }, { unique: true }); // rotation/reuse point-read
refreshTokenSchema.index({ userId: 1 }); // revoke-all (§3.3 matrix)
refreshTokenSchema.index({ familyId: 1 }); // family revocation (BR-35)
// TTL: expireAfterSeconds 0 → Mongo removes rows once `expiresAt` passes.
// Cleanup only (PDV-03) — never a security boundary.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken = model<RefreshTokenDoc>('RefreshToken', refreshTokenSchema);
