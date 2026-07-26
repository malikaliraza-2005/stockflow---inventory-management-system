/** RequireAnon — public marketing gate (mirror of RequireAuth, SMP §6). An
 *  authenticated visitor at a marketing route is sent to their app home;
 *  everyone else sees the marketing pages. UX only — not a security boundary. */
import { Navigate, Outlet } from 'react-router-dom';

import { selectStatus, useAuthStore } from '../../stores/authStore';

export function RequireAnon() {
  const status = useAuthStore(selectStatus);

  // Bootstrap refresh in flight — don't flash marketing at a returning user.
  if (status === 'initializing') return null;

  if (status === 'authenticated') return <Navigate to="/dashboard" replace />;

  return <Outlet />;
}
