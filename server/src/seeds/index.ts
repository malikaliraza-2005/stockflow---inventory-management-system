/**
 * Seed module — DBD §8, 1:1. Idempotent, environment-variable-driven,
 * upsert-by-natural-key only, NEVER destructive on re-run:
 *
 *   1. First Admin  — natural key: email ($setOnInsert only — a re-run never
 *      touches an existing account's password, role, or lifecycle)
 *   2. Settings singleton — natural key: the singleton itself ({} filter);
 *      operator edits survive re-runs (only inserted defaults, never $set)
 *   3. Uncategorized — natural key: name under the §2.2 collation, so a
 *      user-created "uncategorized" can never race a second system row
 *
 * Runs as a RELEASE-PHASE command in every environment (DEP §11) — before new
 * instances start — which is what makes the boot integrity check (integrity.ts)
 * safe to enforce. Tests reuse THIS module (TST §5 seed parity).
 */
import bcrypt from 'bcrypt';

import type { Env } from '../config/env.js';
import type { Logger } from '../lib/logger.js';
import { Category, CATEGORY_NAME_COLLATION } from '../models/Category.js';
import { applyJsonValidators } from '../models/jsonValidators.js';
import { Settings, SETTINGS_DEFAULTS } from '../models/Settings.js';
import { User } from '../models/User.js';

const BCRYPT_COST = 12; // BR-32

export const UNCATEGORIZED_NAME = 'Uncategorized';

export interface SeedResult {
  adminCreated: boolean;
  settingsCreated: boolean;
  uncategorizedCreated: boolean;
}

export async function runSeed(
  env: Pick<Env, 'SEED_ADMIN_EMAIL' | 'SEED_ADMIN_PASSWORD'>,
  logger: Logger,
): Promise<SeedResult> {
  // Indexes first: the email/name unique indexes ARE the idempotency backstop.
  await Promise.all([User.init(), Category.init(), Settings.init()]);

  // DBD §5 second layer — JSON-schema validators (collMod is idempotent).
  // Release-phase placement means every environment carries them before new
  // code serves traffic; tests inherit them by reusing this module (TST §5).
  await applyJsonValidators();

  const email = env.SEED_ADMIN_EMAIL.toLowerCase();

  // 1. First Admin (FR-USER-06) — hash computed only when needed is not worth
  // the roundtrip complexity; cost-12 bcrypt once per release is negligible.
  const passwordHash = await bcrypt.hash(env.SEED_ADMIN_PASSWORD, BCRYPT_COST);
  const adminResult = await User.updateOne(
    { email },
    {
      $setOnInsert: {
        name: 'Administrator',
        email,
        passwordHash,
        role: 'ADMIN',
        isActive: true,
        mustChangePassword: true, // DBD §8 — rotate at first login
        failedLoginCount: 0,
      },
    },
    { upsert: true },
  );

  // 2. Settings singleton (BR-41)
  const settingsResult = await Settings.updateOne(
    {},
    { $setOnInsert: { ...SETTINGS_DEFAULTS } },
    { upsert: true },
  );

  // 3. Uncategorized (BR-28) — collation on the filter per the §2.2 rule
  const categoryResult = await Category.updateOne(
    { name: UNCATEGORIZED_NAME },
    { $setOnInsert: { name: UNCATEGORIZED_NAME, isSystem: true } },
    { upsert: true, collation: CATEGORY_NAME_COLLATION },
  );

  const result: SeedResult = {
    adminCreated: adminResult.upsertedCount > 0,
    settingsCreated: settingsResult.upsertedCount > 0,
    uncategorizedCreated: categoryResult.upsertedCount > 0,
  };
  logger.info(result, 'seed complete (idempotent — created=false means already present)');
  return result;
}
