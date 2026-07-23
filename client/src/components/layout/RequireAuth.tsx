/**
 * RequireAuth — SMP §6: no session → /login with return-to. UX only — the
 * middleware chain is the security boundary (AAD §1). `initializing` renders
 * the app-level skeleton (bootstrap refresh in flight — no login flash).
 */
import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { selectStatus, useAuthStore } from '../../stores/authStore';
import { Skeleton } from '../ui/Skeleton';

export function RequireAuth() {
  const status = useAuthStore(selectStatus);
  const location = useLocation();

  if (status === 'initializing') {
    return (
      <div className="mx-auto mt-16 max-w-3xl space-y-4 px-4" data-testid="bootstrap-skeleton">
        <Skeleton variant="card" />
        <Skeleton variant="table-row" />
        <Skeleton variant="table-row" />
      </div>
    );
  }

  if (status !== 'authenticated') {
    // Return-to restored after login (SMP §5)
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
