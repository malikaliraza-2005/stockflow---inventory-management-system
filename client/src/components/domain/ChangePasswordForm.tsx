/**
 * ChangePasswordForm — UCA §6. Shared by the ForcePasswordChange screen
 * (FEV-02) and the Profile page (F2). Composes FormField + SubmitRow; the
 * confirm match is client-UX only (VAL §4 — the server never sees it).
 * Input is NEVER discarded on failure (EC-28/30).
 */
import { useState, type FormEvent } from 'react';

import { changePassword } from '../../api/auth';
import { ApiError } from '../../api/client';
import { messageFor } from '../../lib/errorMap';
import { changePasswordSchema, withConfirm } from '../../lib/validation/schemas/auth';
import { FormField, fieldAria } from '../ui/FormField';
import { Input } from '../ui/Input';
import { SubmitRow } from '../ui/SubmitRow';

const formSchema = withConfirm(changePasswordSchema);

type FieldErrors = Partial<Record<'currentPassword' | 'newPassword' | 'confirmPassword', string>>;

export interface ChangePasswordFormProps {
  onSuccess?: () => void;
  submitLabel?: string;
}

export function ChangePasswordForm({
  onSuccess,
  submitLabel = 'Change password',
}: ChangePasswordFormProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(undefined);

    const parsed = formSchema.safeParse({ currentPassword, newPassword, confirmPassword });
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof FieldErrors;
        next[field] ??= issue.message;
      }
      setErrors(next);
      return;
    }

    setErrors({});
    setLoading(true);
    try {
      await changePassword(currentPassword, newPassword);
      onSuccess?.();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'UNAUTHORIZED') {
        // Wrong current password — inline on its field, input preserved
        setErrors({ currentPassword: 'Current password is incorrect' });
      } else if (error instanceof ApiError) {
        setFormError(messageFor(error.code));
      } else {
        setFormError(messageFor('INTERNAL_ERROR'));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} noValidate className="space-y-2">
      <FormField
        label="Current password"
        htmlFor="current-password"
        error={errors.currentPassword}
        required
      >
        <Input
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          {...fieldAria('current-password', errors.currentPassword)}
        />
      </FormField>
      <FormField
        label="New password"
        htmlFor="new-password"
        error={errors.newPassword}
        hint="10–64 characters with at least one letter and one number"
        required
      >
        <Input
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          {...fieldAria('new-password', errors.newPassword, 'hint')}
        />
      </FormField>
      <FormField
        label="Confirm new password"
        htmlFor="confirm-password"
        error={errors.confirmPassword}
        required
      >
        <Input
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          {...fieldAria('confirm-password', errors.confirmPassword)}
        />
      </FormField>
      {formError && (
        <p role="alert" className="text-sm text-danger-600">
          {formError}
        </p>
      )}
      <SubmitRow submitLabel={submitLabel} loading={loading} />
    </form>
  );
}
