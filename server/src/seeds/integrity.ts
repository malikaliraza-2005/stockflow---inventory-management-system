/**
 * Boot integrity check — DBD §8 / BEA §8, adapted for SaaS multi-tenancy.
 *
 * In a single-org system this asserted a global settings singleton + ≥ 1 active
 * Admin. Under multi-tenancy those invariants are PER-TENANT and are guaranteed
 * atomically at signup (`provisionTenant`), so an EMPTY system (zero tenants,
 * before anyone signs up) is a perfectly valid, ready state — not a failure.
 *
 * What boot still verifies (cheaply, in system context): the system is
 * COHERENT — if any tenant exists, the per-tenant bootstrap data landed (≥ 1
 * active Admin and ≥ 1 settings document exist system-wide). A failure carries
 * the DBD-mandated explicit remediation message.
 */
import { runAsSystem } from '../lib/tenantContext.js';
import { Organization } from '../models/Organization.js';
import { Settings } from '../models/Settings.js';
import { User } from '../models/User.js';

export class IntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntegrityError';
  }
}

export async function verifyBootIntegrity(): Promise<void> {
  // These read tenant-scoped models with no tenant in scope — system context.
  const [orgCount, settingsCount, activeAdminCount] = await runAsSystem(() =>
    Promise.all([
      Organization.countDocuments({}),
      Settings.countDocuments({}),
      User.countDocuments({ role: 'ADMIN', isActive: true }),
    ]),
  );

  // Fresh SaaS install — no tenants yet. Valid and ready.
  if (orgCount === 0) return;

  const problems: string[] = [];
  if (settingsCount === 0) {
    problems.push('tenants exist but no settings document was found (BR-41)');
  }
  if (activeAdminCount === 0) {
    problems.push('tenants exist but no active Admin account exists (BR-30)');
  }

  if (problems.length > 0) {
    throw new IntegrityError(
      `Boot integrity check failed: ${problems.join('; ')}. ` +
        'Remediation: run the seed release-phase command (`npm run seed`) against this ' +
        'environment with SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD set, then restart. (DBD §8, DEP §11)',
    );
  }
}
