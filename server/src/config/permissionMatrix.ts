/**
 * THE permission matrix — SRS §5.2 as code, THE single authority (AAD §5.1):
 * backend route annotations spread these rows into `authorize(...)`, and the
 * frontend's `usePermission` matrix is GENERATED from this file
 * (scripts/generate-permissions.mjs → client/src/lib/permissions.generated.ts,
 * CI drift-checked) — never hand-maintained in two places (FD-3).
 *
 * Evolution rule: a capability changes in SRS §5.2 FIRST, then here, then the
 * generator re-runs. The literal between the BEGIN/END markers must stay a
 * plain JSON-compatible object — the generator extracts it textually.
 */
import type { UserRole } from '../models/User.js';

// BEGIN PERMISSION MATRIX (SRS §5.2 — verbatim, one key per capability row)
export const PERMISSION_MATRIX = {
  'products.view': ['ADMIN', 'STAFF'],
  'products.manage': ['ADMIN'],
  'products.lifecycle': ['ADMIN'],
  'products.images': ['ADMIN'],
  'categories.view': ['ADMIN', 'STAFF'],
  'categories.manage': ['ADMIN'],
  'movements.stockInOut': ['ADMIN', 'STAFF'],
  'movements.adjust': ['ADMIN'],
  'transactions.view': ['ADMIN', 'STAFF'],
  'audit.view': ['ADMIN'],
  'dashboard.view': ['ADMIN', 'STAFF'],
  'reports.view': ['ADMIN', 'STAFF'],
  'reports.export': ['ADMIN'],
  'reports.consistency': ['ADMIN'],
  'users.manage': ['ADMIN'],
  'settings.manage': ['ADMIN'],
  'profile.own': ['ADMIN', 'STAFF'],
} as const;
// END PERMISSION MATRIX

export type Capability = keyof typeof PERMISSION_MATRIX;

/** Roles allowed for a capability — routes spread this into `authorize(...)`. */
export function rolesFor(capability: Capability): readonly UserRole[] {
  return PERMISSION_MATRIX[capability];
}
