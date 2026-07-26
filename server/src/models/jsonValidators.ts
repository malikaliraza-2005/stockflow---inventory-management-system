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
import { ADJUSTMENT_REASONS, TRANSACTION_TYPES } from './Transaction.js';
import { USER_ROLES } from './User.js';

/** DBD §2.1 — `users`. */
const usersValidator = {
  $jsonSchema: {
    bsonType: 'object',
    // `passwordHash` is NOT required — Google-only accounts have none. It is
    // still validated (minLength 1) WHEN present. `authProvider` is optional at
    // this layer so updates to pre-provider documents can never be rejected.
    required: [
      'tenantId',
      'name',
      'email',
      'role',
      'isActive',
      'mustChangePassword',
      'failedLoginCount',
    ],
    properties: {
      tenantId: { bsonType: 'objectId' }, // SaaS isolation (defense-in-depth)
      name: { bsonType: 'string', minLength: 2, maxLength: 80 },
      email: { bsonType: 'string', minLength: 3, maxLength: 254 },
      passwordHash: { bsonType: 'string', minLength: 1 },
      authProvider: { enum: ['LOCAL', 'GOOGLE'] },
      googleSub: { bsonType: 'string', minLength: 1 }, // one Google identity = one account
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
    required: ['tenantId', 'actorId', 'entityType', 'action', 'entityLabel', 'createdAt'],
    // DES-1 / DBD §6.3: reject the very presence of `updatedAt`.
    not: { required: ['updatedAt'] },
    properties: {
      tenantId: { bsonType: 'objectId' }, // SaaS isolation (defense-in-depth)
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

/** DBD §2.3 — `products` (F4). Second layer behind the Mongoose schema; catches
 * native/driver writes. The exactly-one-primary-image (DBR-03) and
 * `quantity == Σ ledger` (DN-1) invariants are NOT expressible here — they are
 * named service invariants (DBD §5). `barcode` carries `minLength: 1` so an
 * empty string can never reach the sparse unique index (PDV-04). */
const productsValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: [
      'tenantId',
      'name',
      'sku',
      'categoryId',
      'costPrice',
      'sellingPrice',
      'quantity',
      'lowStockThreshold',
      'isArchived',
      'version',
    ],
    properties: {
      tenantId: { bsonType: 'objectId' }, // SaaS isolation (defense-in-depth)
      name: { bsonType: 'string', minLength: 2, maxLength: 120 },
      sku: { bsonType: 'string', minLength: 3, maxLength: 32 },
      barcode: { bsonType: 'string', minLength: 1, maxLength: 64 }, // PDV-04 (sparse unique)
      description: { bsonType: 'string', maxLength: 2000 },
      categoryId: { bsonType: 'objectId' },
      costPrice: { bsonType: 'decimal', minimum: 0 }, // BR-08
      sellingPrice: { bsonType: 'decimal', minimum: 0 },
      quantity: { bsonType: 'int', minimum: 0 }, // BR-10 defense-in-depth
      lowStockThreshold: { bsonType: 'int', minimum: 0 },
      isArchived: { bsonType: 'bool' },
      version: { bsonType: 'int', minimum: 0 }, // BR-24
      images: {
        bsonType: 'array',
        maxItems: 5, // BR-37
        items: {
          bsonType: 'object',
          required: ['publicId', 'url', 'isPrimary'],
          properties: {
            publicId: { bsonType: 'string', minLength: 1 },
            url: { bsonType: 'string', minLength: 1 },
            isPrimary: { bsonType: 'bool' },
          },
        },
      },
    },
  },
};

/** DBD §2.8 — `counters` (F4). Prefix-keyed string `_id`; monotonic sequence. */
const countersValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['_id', 'seq'],
    properties: {
      _id: { bsonType: 'string', minLength: 1 },
      seq: { bsonType: 'int', minimum: 0 },
    },
  },
};

/** DBD §2.7 — `settings` (F11). One document PER TENANT (SaaS). */
const settingsValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['tenantId', 'currency', 'defaultLowStockThreshold', 'movementWarningThreshold'],
    properties: {
      tenantId: { bsonType: 'objectId' }, // SaaS isolation (defense-in-depth)
      currency: { bsonType: 'string', minLength: 3, maxLength: 3 }, // ISO 4217
      defaultLowStockThreshold: { bsonType: 'int', minimum: 0 },
      movementWarningThreshold: { bsonType: 'int', minimum: 1 },
    },
  },
};

/** DBD §2.4 — `transactions` (F6) ∎ append-only. Second layer behind the Mongoose
 * schema; catches native/driver writes into the ledger. Like `auditlogs`, it
 * REJECTS any document carrying `updatedAt` (DES-1, DBD §6.3) — a ledger row can
 * never look edited. `quantityAfter ≥ 0` and the closed type/reason enums are
 * defense-in-depth (BR-10); `quantityChange ≠ 0` (BR-12) and `quantity == Σ
 * ledger` (DN-1) are service-enforced invariants, not expressible here.
 * `idempotencyKey` carries `minLength: 1` so an empty string can never reach the
 * sparse-unique index (PDV-04). */
const transactionsValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: [
      'tenantId',
      'productId',
      'type',
      'quantityChange',
      'quantityAfter',
      'userId',
      'createdAt',
    ],
    not: { required: ['updatedAt'] }, // DES-1: append-only, never edited
    properties: {
      tenantId: { bsonType: 'objectId' }, // SaaS isolation (defense-in-depth)
      productId: { bsonType: 'objectId' },
      type: { enum: [...TRANSACTION_TYPES] }, // closed set (PDV-01)
      quantityChange: { bsonType: 'int' }, // signed; ≠ 0 is service-enforced (BR-12)
      quantityAfter: { bsonType: 'int', minimum: 0 }, // DN-2 snapshot
      userId: { bsonType: 'objectId' },
      reason: { enum: [...ADJUSTMENT_REASONS] }, // required-iff-ADJUSTMENT is service-enforced
      note: { bsonType: 'string', maxLength: 500 },
      refTransactionId: { bsonType: 'objectId' },
      idempotencyKey: { bsonType: 'string', minLength: 1 }, // PDV-04 (sparse unique)
      createdAt: { bsonType: 'date' },
    },
  },
};

/** Collection name (Mongoose pluralization) → validator document. */
export const JSON_VALIDATORS: Readonly<Record<string, object>> = {
  users: usersValidator,
  refreshtokens: refreshTokensValidator,
  auditlogs: auditLogsValidator,
  products: productsValidator,
  counters: countersValidator,
  settings: settingsValidator,
  transactions: transactionsValidator,
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
