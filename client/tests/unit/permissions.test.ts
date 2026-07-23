/**
 * F1 — the generated §5.2 matrix, table-driven over every capability × role
 * (SMA §10). The generation-not-hand-written guarantee itself is enforced
 * server-side (generator --check in CI); here we pin the SEMANTICS.
 */
import { describe, expect, it } from 'vitest';

import { PERMISSION_MATRIX, roleCan, type Capability } from '../../src/lib/permissions.generated';

/** SRS §5.2 verbatim — the expected truth table. */
const EXPECTED: Record<Capability, { ADMIN: boolean; STAFF: boolean }> = {
  'products.view': { ADMIN: true, STAFF: true },
  'products.manage': { ADMIN: true, STAFF: false },
  'products.lifecycle': { ADMIN: true, STAFF: false },
  'products.images': { ADMIN: true, STAFF: false },
  'categories.view': { ADMIN: true, STAFF: true },
  'categories.manage': { ADMIN: true, STAFF: false },
  'movements.stockInOut': { ADMIN: true, STAFF: true },
  'movements.adjust': { ADMIN: true, STAFF: false },
  'transactions.view': { ADMIN: true, STAFF: true },
  'audit.view': { ADMIN: true, STAFF: false },
  'dashboard.view': { ADMIN: true, STAFF: true },
  'reports.view': { ADMIN: true, STAFF: true },
  'reports.export': { ADMIN: true, STAFF: false },
  'reports.consistency': { ADMIN: true, STAFF: false },
  'users.manage': { ADMIN: true, STAFF: false },
  'settings.manage': { ADMIN: true, STAFF: false },
  'profile.own': { ADMIN: true, STAFF: true },
};

describe('permission matrix semantics (SRS §5.2)', () => {
  it('covers exactly the expected capability set', () => {
    expect(Object.keys(PERMISSION_MATRIX).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(Object.entries(EXPECTED))('%s resolves per the SRS row', (capability, expected) => {
    expect(roleCan('ADMIN', capability as Capability)).toBe(expected.ADMIN);
    expect(roleCan('STAFF', capability as Capability)).toBe(expected.STAFF);
  });
});
