/**
 * MongoDB JSON-schema validators — DBD §5's SECOND validation layer (BR-10
 * defense-in-depth): Mongoose schemas are the first line with rich messages;
 * these validators catch buggy code paths that bypass Mongoose (native driver
 * writes, future migrations, operator mistakes).
 *
 * Applied idempotently at the seed release phase (DEP §11 — same home as
 * index init), so every environment carries them before new code serves
 * traffic. `collMod` on an existing collection, `create` when absent.
 *
 * Phase-1 scope: `users`, `refreshtokens`, `auditlogs` (F1/F2 T-b). Later
 * collections gain validators with their owning features (first-consumer law,
 * IMP-020): products/counters → F4, categories → F3, settings → F11,
 * transactions → F6.
 *
 * Deliberate choices:
 *  - No `additionalProperties: false` — Mongoose metadata (`__v`) and additive
 *    evolution must not brick writes; the closed shape is the schema layer's job.
 *  - `auditlogs` REJECTS any document carrying `updatedAt` (DES-1, DBD §6.3):
 *    `not: { required: ['updatedAt'] }` — an append-only row can never look
 *    like it was edited.
 *  - Sparse-indexed strings (`resetTokenHash`, `tokenHash`) carry
 *    `minLength: 1` — an empty string must never reach a sparse index (PDV-04).
 */
import mongoose from 'mongoose';

import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from './AuditLog.js';
import { USER_ROLES } from './User.js';

/** DBD §2.1 — `users`. */
const usersValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: [
      'name',
      'email',
      'passwordHash',
      'role',
      'isActive',
      'mustChangePassword',
      'failedLoginCount',
    ],
    properties: {
      name: { bsonType: 'string', minLength: 2, maxLength: 80 },
      email: { bsonType: 'string', minLength: 3, maxLength: 254 },
      passwordHash: { bsonType: 'string', minLength: 1 },
      role: { enum: [...USER_ROLES] },
      isActive: { bsonType: 'bool' },
      mustChangePassword: { bsonType: 'bool' },
      failedLoginCount: { bsonType: 'int', minimum: 0 },
      lockedUntil: { bsonType: ['date', 'null'] },
      resetTokenHash: { bsonType: 'string', minLength: 1 }, // PDV-04
      resetTokenExpiresAt: { bsonType: 'date' },
      lastLoginAt: { bsonType: 'date' },
    },
  },
};

/** DBD §2.5 — `refreshtokens`. */
const refreshTokensValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['userId', 'tokenHash', 'familyId', 'expiresAt'],
    properties: {
      userId: { bsonType: 'objectId' },
      tokenHash: { bsonType: 'string', minLength: 1 }, // PDV-04 (unique index)
      familyId: { bsonType: 'string', minLength: 1 },
      expiresAt: { bsonType: 'date' },
      rotatedAt: { bsonType: ['date', 'null'] },
      revokedAt: { bsonType: ['date', 'null'] },
      ip: { bsonType: 'string' },
      userAgent: { bsonType: 'string' },
    },
  },
};

/** DBD §2.6 — `auditlogs` ∎ append-only. */
const auditLogsValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['actorId', 'entityType', 'action', 'entityLabel', 'createdAt'],
    // DES-1 / DBD §6.3: reject the very presence of `updatedAt`.
    not: { required: ['updatedAt'] },
    properties: {
      actorId: { bsonType: 'objectId' },
      entityType: { enum: [...AUDIT_ENTITY_TYPES] },
      entityId: { bsonType: 'objectId' },
      action: { enum: [...AUDIT_ACTIONS] }, // closed set (PDV-01)
      entityLabel: { bsonType: 'string', minLength: 1 }, // DN-4
      changes: {
        bsonType: 'array',
        items: {
          bsonType: 'object',
          required: ['field'],
          properties: { field: { bsonType: 'string', minLength: 1 } },
        },
      },
      ip: { bsonType: 'string' },
      createdAt: { bsonType: 'date' },
    },
  },
};

/** Collection name (Mongoose pluralization) → validator document. */
export const JSON_VALIDATORS: Readonly<Record<string, object>> = {
  users: usersValidator,
  refreshtokens: refreshTokensValidator,
  auditlogs: auditLogsValidator,
};

const NAMESPACE_NOT_FOUND = 26;

/**
 * Apply (or re-apply) every validator — idempotent: `collMod` simply replaces
 * the stored validator, so re-running a release is always safe.
 * `validationLevel: strict` per DBD §1; `validationAction: error` (reject, not warn).
 */
export async function applyJsonValidators(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('applyJsonValidators requires an active mongoose connection');

  for (const [collection, validator] of Object.entries(JSON_VALIDATORS)) {
    try {
      await db.command({
        collMod: collection,
        validator,
        validationLevel: 'strict',
        validationAction: 'error',
      });
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code !== NAMESPACE_NOT_FOUND) throw error;
      // First release against a fresh database — create with the validator.
      await db.createCollection(collection, {
        validator,
        validationLevel: 'strict',
        validationAction: 'error',
      });
    }
  }
}
