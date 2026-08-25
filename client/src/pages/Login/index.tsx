/**
 * Login page — UC-01 / WIR login frame. Errors stay GENERIC (AAD §2 — never
 * "wrong password" vs "no such user"; the 423 lockout state is the one
 * distinct message). Input survives every failure (EC-28). Successful login
 * restores the return-to deep link (SMP §5).
 */
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';

import { login } from '../../api/auth';
import { ApiError } from '../../api/client';
import { AlertBanner } from '../../components/ui/AlertBanner';
import { FormField, fieldAria } from '../../components/ui/FormField';
import { GoogleSignInButton } from '../../components/ui/GoogleSignInButton';
import { Input } from '../../components/ui/Input';
import { SubmitRow } from '../../components/ui/SubmitRow';
import { messageFor } from '../../lib/errorMap';
import { loginSchema } from '../../lib/validation/schemas/auth';
import { selectIsAuthenticated, useAuthStore } from '../../stores/authStore';

type FieldErrors = Partial<Record<'email' | 'password', string>>;

export default function LoginPage() {
  const isAuthenticated = useAuthStore(selectIsAuthenticated);
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  if (isAuthenticated) {
    const from = (location.state as { from?: { pathname: string } } | null)?.from;
    return <Navigate to={from?.pathname ?? '/dashboard'} replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(undefined);

    const parsed = loginSchema.safeParse({ email, password });
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
      await login(parsed.data.email, parsed.data.password);
      // The isAuthenticated redirect above takes over on re-render
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'INTERNAL_ERROR';
      // Generic for UNAUTHORIZED; distinct only where the design says so
      setFormError(code === 'UNAUTHORIZED' ? 'Invalid email or password.' : messageFor(code));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Sign in</h1>
        <p className="text-sm text-neutral-500">
          Welcome back — pick up exactly where your team left off.
        </p>
      </header>
      {formError && <AlertBanner tone="danger" message={formError} />}
      <form onSubmit={(event) => void handleSubmit(event)} noValidate className="space-y-2">
        <FormField label="Email" htmlFor="login-email" error={errors.email} required>
          <Input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            {...fieldAria('login-email', errors.email)}
          />
        </FormField>
        <FormField label="Password" htmlFor="login-password" error={errors.password} required>
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            {...fieldAria('login-password', errors.password)}
          />
        </FormField>
        <SubmitRow submitLabel="Sign in" loading={loading} fullWidth />
      </form>
      <GoogleSignInButton text="signin_with" />
      <p className="text-center text-sm text-neutral-500">
        New here?{' '}
        <Link to="/signup" className="font-semibold text-brand-600 hover:text-brand-700">
          Create a workspace
        </Link>
      </p>
    </div>
  );
}
