/**
 * F2 — the FD-3 "generated, never hand-maintained" guarantee, executable:
 * the client copy must be byte-identical to the generator's output from the
 * canonical SRS §5.2 definition (also enforced as a CI drift step).
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { PERMISSION_MATRIX, rolesFor } from '../../src/config/permissionMatrix.js';

describe('permission matrix (SRS §5.2 — single definition, both tiers)', () => {
  it('client copy matches the canonical definition (generator --check)', () => {
    expect(() =>
      execFileSync(process.execPath, ['scripts/generate-permissions.mjs', '--check'], {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
      }),
    ).not.toThrow();
  });

  it('encodes the §5.2 rows faithfully (spot checks on the load-bearing rows)', () => {
    expect(rolesFor('users.manage')).toEqual(['ADMIN']);
    expect(rolesFor('movements.stockInOut')).toEqual(['ADMIN', 'STAFF']);
    expect(rolesFor('movements.adjust')).toEqual(['ADMIN']);
    expect(rolesFor('audit.view')).toEqual(['ADMIN']);
    expect(rolesFor('profile.own')).toEqual(['ADMIN', 'STAFF']);
    expect(rolesFor('reports.export')).toEqual(['ADMIN']);
  });

  it('every capability names at least one role — no dead rows', () => {
    for (const roles of Object.values(PERMISSION_MATRIX)) {
      expect(roles.length).toBeGreaterThan(0);
    }
  });
});
