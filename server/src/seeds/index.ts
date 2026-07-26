/**
 * Seed module — DBD §8, adapted for SaaS multi-tenancy. Idempotent,
 * environment-variable-driven, NEVER destructive on re-run:
 *
 *   1. Build indexes + apply the JSON-schema validators (release-phase, DEP §11)
 *      — the boot integrity check depends on these existing.
 *   2. Provision the BOOTSTRAP tenant (org + first Admin + per-tenant settings +
 *      Uncategorized) — only when its Admin does not already exist. In SaaS the
 *      first admin is a full tenant, created via the same `provisionTenant`
 *      path public signup uses; a re-run is a no-op.
 *
 * Natural key for idempotency: the Admin email (globally unique across tenants).
 * Runs as a RELEASE-PHASE command in every environment (DEP §11). Tests reuse
 * THIS module (TST §5 seed parity).
 */
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';

import type { Env } from '../config/env.js';
import type { Logger } from '../lib/logger.js';
import { runAsSystem } from '../lib/tenantContext.js';
import { Category } from '../models/Category.js';
import { JobLock } from '../models/JobLock.js';
import { applyJsonValidators } from '../models/jsonValidators.js';
import { Organization } from '../models/Organization.js';
import { Settings } from '../models/Settings.js';
import { Transaction } from '../models/Transaction.js';
import { User } from '../models/User.js';
import { provisionTenant, UNCATEGORIZED_NAME } from '../services/provisioning.js';

const BCRYPT_COST = 12; // BR-32

/** The bootstrap tenant's display identity (dev/demo; SaaS tenants come from signup). */
const BOOTSTRAP_ORG_NAME = 'Demo Workspace';
const BOOTSTRAP_ORG_SLUG = 'demo-workspace';

export { UNCATEGORIZED_NAME };

export interface SeedResult {
  adminCreated: boolean;
  settingsCreated: boolean;
  uncategorizedCreated: boolean;
}

export async function runSeed(
  env: Pick<Env, 'SEED_ADMIN_EMAIL' | 'SEED_ADMIN_PASSWORD'>,
  logger: Logger,
): Promise<SeedResult> {
  // Indexes first (the unique indexes ARE part of the idempotency backstop), then
  // the DBD §5 second layer — JSON-schema validators (collMod is idempotent).
  await Promise.all([
    Organization.init(),
    User.init(),
    Category.init(),
    Settings.init(),
    Transaction.init(),
    JobLock.init(), // A-8 lease TTL index (BEV-05)
  ]);
  await applyJsonValidators();

  const email = env.SEED_ADMIN_EMAIL.toLowerCase();

  // Idempotent: the bootstrap tenant exists iff its Admin (globally-unique
  // email) exists. A re-run touches nothing.
  const existingAdmin = await runAsSystem(() => User.exists({ email }));
  if (existingAdmin) {
    logger.info(
      { tenantProvisioned: false },
      'seed complete (bootstrap tenant already present — idempotent no-op)',
    );
    return { adminCreated: false, settingsCreated: false, uncategorizedCreated: false };
  }

  const passwordHash = await bcrypt.hash(env.SEED_ADMIN_PASSWORD, BCRYPT_COST);
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(
      async () => {
        await provisionTenant(
          {
            organizationName: BOOTSTRAP_ORG_NAME,
            slug: BOOTSTRAP_ORG_SLUG,
            adminName: 'Administrator',
            adminEmail: email,
            adminPasswordHash: passwordHash,
            mustChangePassword: true, // DBD §8 — rotate at first login
          },
          { session },
        );
      },
      { readConcern: { level: 'majority' }, writeConcern: { w: 'majority' } },
    );
  } finally {
    await session.endSession();
  }

  logger.info({ tenantProvisioned: true }, 'seed complete (bootstrap tenant created)');
  return { adminCreated: true, settingsCreated: true, uncategorizedCreated: true };
}
