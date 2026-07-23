/**
 * Reset Password page — UC-03 / SMP §5: `?token=…` from the out-of-band link.
 * Invalid/expired/used token → IN-PAGE error state with "request a new reset"
 * guidance (no redirect loop). Success routes to login.
 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { resetPassword } from '../../api/auth';
import { ApiError } from '../../api/client';
import { AlertBanner } from '../../components/ui/AlertBanner';
import { FormField, fieldAria } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { SubmitRow } from '../../components/ui/SubmitRow';
import { messageFor } from '../../lib/errorMap';
import { resetPasswordSchema, withConfirm } from '../../lib/validation/schemas/auth';

// The token comes from the URL, not the form — validate the typed fields only
const formSchema = withConfirm(resetPasswordSchema.omit({ token: true }));

type FieldErrors = Partial<Record<'newPassword' | 'confirmPassword', string>>;

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') ?? '';

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [tokenRejected, setTokenRejected] = useState(false);
  const [formError, setFormError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  // Arriving without a token at all is the same dead-link state
  if (!token || tokenRejected) {
    return (
      <div className="space-y-4" data-testid="reset-token-invalid">
        <AlertBanner
          tone="danger"
          message="This reset link is invalid or has expired. Ask your administrator for a new one."
        />
        <Link to="/login" className="text-sm text-brand-600 hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(undefined);

    const parsed = formSchema.safeParse({ newPassword, confirmPassword });
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
      await resetPassword(token, newPassword);
      navigate('/login', { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'UNAUTHORIZED') {
        setTokenRejected(true); // single-use / expired — the in-page state
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
    <div className="space-y-4">
      <h2 className="text-lg font-medium text-gray-900">Choose a new password</h2>
      {formError && <AlertBanner tone="danger" message={formError} />}
      <form onSubmit={(event) => void handleSubmit(event)} noValidate className="space-y-2">
        <FormField
          label="New password"
          htmlFor="reset-password"
          error={errors.newPassword}
          hint="10–64 characters with at least one letter and one number"
          required
        >
          <Input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            {...fieldAria('reset-password', errors.newPassword, 'hint')}
          />
        </FormField>
        <FormField
          label="Confirm password"
          htmlFor="reset-confirm"
          error={errors.confirmPassword}
          required
        >
          <Input
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            {...fieldAria('reset-confirm', errors.confirmPassword)}
          />
        </FormField>
        <SubmitRow submitLabel="Set password" loading={loading} />
      </form>
    </div>
  );
}
