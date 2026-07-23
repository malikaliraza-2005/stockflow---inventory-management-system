/**
 * usePermission — FD-3: components ask capability questions
 * (`can('users.manage')`), NEVER compare roles inline. Reads authStore's role
 * against the GENERATED §5.2 matrix copy (permissions.generated.ts — CI
 * drift-checked against the server's canonical definition).
 */
import { useCallback } from 'react';

import { roleCan, type Capability } from '../lib/permissions.generated';
import { selectRole, useAuthStore } from '../stores/authStore';

export function usePermission(): (capability: Capability) => boolean {
  const role = useAuthStore(selectRole);
  return useCallback(
    (capability: Capability) => (role ? roleCan(role, capability) : false),
    [role],
  );
}
