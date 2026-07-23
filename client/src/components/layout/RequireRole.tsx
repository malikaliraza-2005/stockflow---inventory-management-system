/**
 * RequireRole — SMP §6: unauthorized → redirect "/" + notice toast (EC-19).
 * No dedicated 403 page (ratified, SMP §9). The server's 403 remains the
 * boundary; this is courtesy UX.
 */
import { useEffect } from 'react';
import { Navigate, Outlet } from 'react-router-dom';

import { useToast } from '../../hooks/useToast';
import { selectRole, useAuthStore } from '../../stores/authStore';
import type { Role } from '../../lib/permissions.generated';

export function RequireRole({ role }: { role: Role }) {
  const currentRole = useAuthStore(selectRole);
  const toast = useToast();
  const allowed = currentRole === role;

  useEffect(() => {
    if (!allowed) toast.info("That area needs a different role — you've been redirected.");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one notice per mount
  }, []);

  if (!allowed) return <Navigate to="/" replace />;
  return <Outlet />;
}
