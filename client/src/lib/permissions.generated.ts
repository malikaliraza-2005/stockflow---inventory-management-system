/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Frontend copy of the SRS §5.2 permission matrix (FD-3), generated from
 * server/src/config/permissionMatrix.ts by server/scripts/generate-permissions.mjs.
 * CI fails if this file drifts from the canonical definition. `usePermission()`
 * reads it; components ask capability questions, never compare roles inline.
 */
export type Role = 'ADMIN' | 'STAFF';

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

export type Capability = keyof typeof PERMISSION_MATRIX;

export function roleCan(role: Role, capability: Capability): boolean {
  return (PERMISSION_MATRIX[capability] as readonly Role[]).includes(role);
}
