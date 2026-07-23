/**
 * ForcePasswordChange gate — FEV-02 / SMP §6: while `mustChangePassword` is
 * set, EVERY protected route renders the change-password screen until
 * cleared. Deliberately NOT a URL — no account-state leak into history. The
 * server co-enforces (AAD §2: only change-password/logout/refresh pass).
 */
import { Outlet } from 'react-router-dom';

import { logout } from '../../api/auth';
import { useToast } from '../../hooks/useToast';
import { selectMustChangePassword, useAuthStore } from '../../stores/authStore';
import { ChangePasswordForm } from '../domain/ChangePasswordForm';
import { Button } from '../ui/Button';

export function ForcePasswordChangeGate() {
  const mustChange = useAuthStore(selectMustChangePassword);
  const toast = useToast();

  if (!mustChange) return <Outlet />;

  return (
    <main
      className="mx-auto mt-16 w-full max-w-md space-y-6 px-4"
      data-testid="force-password-change"
    >
      <div className="space-y-2 text-center">
        <h1 className="text-xl font-semibold text-gray-900">Set a new password</h1>
        <p className="text-sm text-gray-600">
          Your password was set by an administrator. Choose your own to continue — every other
          screen stays locked until you do.
        </p>
      </div>
      <ChangePasswordForm
        submitLabel="Set new password"
        onSuccess={() => toast.success('Password updated — welcome!')}
      />
      <div className="text-center">
        <Button variant="ghost" onClick={() => void logout()}>
          Sign out
        </Button>
      </div>
    </main>
  );
}
