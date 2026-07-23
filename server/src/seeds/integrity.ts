/**
 * Boot integrity check — DBD §8 / BEA §8: readiness requires the settings
 * singleton (BR-41) and ≥ 1 active Admin (BR-30). A failure carries the
 * DBD-mandated EXPLICIT REMEDIATION MESSAGE — the operator must know the fix,
 * not just the fact.
 */
import { Settings } from '../models/Settings.js';
import { User } from '../models/User.js';

export class IntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntegrityError';
  }
}

export async function verifyBootIntegrity(): Promise<void> {
  const [settingsCount, activeAdminCount] = await Promise.all([
    Settings.countDocuments({}),
    User.countDocuments({ role: 'ADMIN', isActive: true }), // {role,isActive} index
  ]);

  const problems: string[] = [];
  if (settingsCount === 0) {
    problems.push('settings singleton missing (BR-41)');
  }
  if (activeAdminCount === 0) {
    problems.push('no active Admin account exists (BR-30)');
  }

  if (problems.length > 0) {
    throw new IntegrityError(
      `Boot integrity check failed: ${problems.join('; ')}. ` +
        'Remediation: run the seed release-phase command (`npm run seed`) against this ' +
        'environment with SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD set, then restart. (DBD §8, DEP §11)',
    );
  }
}
