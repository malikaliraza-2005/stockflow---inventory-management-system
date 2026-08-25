/**
 * Signup page (SaaS) — public self-service tenant creation. Creates an
 * organization + its first Admin (the owner) and logs them straight in.
 *
 * Validation is PROGRESSIVE so the user always knows what to fix: each field is
 * checked on blur, then re-checked live on every keystroke once it has been
 * touched, and everything is checked on submit. Messages are per-rule (the
 * password says exactly which requirement is missing). Input survives every
 * failure (EC-28).
 */
import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';

import { signup } from '../../api/auth';
import { ApiError } from '../../api/client';
import { AlertBanner } from '../../components/ui/AlertBanner';
import { FormField, fieldAria } from '../../components/ui/FormField';
import { GoogleSignInButton } from '../../components/ui/GoogleSignInButton';
import { Input } from '../../components/ui/Input';
import { SubmitRow } from '../../components/ui/SubmitRow';
import { messageFor } from '../../lib/errorMap';
import { signupSchema } from '../../lib/validation/schemas/auth';
import { selectIsAuthenticated, useAuthStore } from '../../stores/authStore';

type Field = 'organizationName' | 'name' | 'email' | 'password';
type Values = Record<Field, string>;
type FieldErrors = Partial<Record<Field, string>>;
type Touched = Partial<Record<Field, boolean>>;

const EMPTY: Values = { organizationName: '', name: '', email: '', password: '' };
const PASSWORD_HINT = 'At least 10 characters, including a letter and a number.';
const FIELDS: readonly Field[] = ['organizationName', 'name', 'email', 'password'];
const ALL_TOUCHED: Touched = { organizationName: true, name: true, email: true, password: true };

/** First message per field from the schema (empty object when everything passes). */
function validate(values: Values): FieldErrors {
  const parsed = signupSchema.safeParse(values);
  if (parsed.success) return {};
  const next: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as Field;
    next[field] ??= issue.message; // first (most relevant) message wins
  }
  return next;
}

/**
 * A server VALIDATION_ERROR carries `details: [{ field, message }]` (VAL §9) —
 * the AUTHORITATIVE per-field reasons. Map the ones that name a form field so
 * the user sees exactly what the server rejected and why (never a bare "fix the
 * fields" banner). Returns the field errors, or null if nothing mapped.
 */
function fieldErrorsFromDetails(details: unknown): FieldErrors | null {
  if (!Array.isArray(details)) return null;
  const next: FieldErrors = {};
  for (const item of details) {
    const field = (item as { field?: string }).field as Field | undefined;
    const message = (item as { message?: string }).message;
    if (field && FIELDS.includes(field) && message) next[field] ??= message;
  }
  return Object.keys(next).length > 0 ? next : null;
}

/**
 * The password rules, mirrored from `signupPassword` (auth schemas) as live
 * checkmarks — the same requirements the hint states, shown ticking off as they
 * type. Purely a visual aid: it is aria-hidden because the hint text (and, on
 * failure, the field error) already carry the requirement to assistive tech.
 */
const PASSWORD_RULES: readonly { label: string; met: (value: string) => boolean }[] = [
  { label: '10+ characters', met: (v) => v.length >= 10 && v.length <= 64 },
  { label: 'A letter', met: (v) => /[A-Za-z]/.test(v) },
  { label: 'A number', met: (v) => /\d/.test(v) },
];

function PasswordRules({ value }: { value: string }) {
  if (value.length === 0) return null;
  return (
    <ul aria-hidden="true" className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
      {PASSWORD_RULES.map((rule) => {
        const met = rule.met(value);
        return (
          <li
            key={rule.label}
            className={`flex items-center gap-1.5 text-xs transition-colors ${
              met ? 'text-success-600' : 'text-neutral-400'
            }`}
          >
            <span
              className={`grid h-3.5 w-3.5 place-items-center rounded-full text-[9px] font-bold text-white transition-colors ${
                met ? 'bg-success-600' : 'bg-neutral-300'
              }`}
            >
              ✓
            </span>
            {rule.label}
          </li>
        );
      })}
    </ul>
  );
}

/** Every human message inside a server `details[]` — the banner fallback so a
 *  concrete reason is shown even when nothing maps to a known field. */
function detailMessages(details: unknown): string[] {
  if (!Array.isArray(details)) return [];
  return details
    .map((item) => (item as { message?: string }).message)
    .filter((m): m is string => typeof m === 'string' && m.length > 0);
}

export default function SignupPage() {
  const isAuthenticated = useAuthStore(selectIsAuthenticated);
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<Touched>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  if (isAuthenticated) return <Navigate to="/dashboard" replace />;

  function setField(field: Field, value: string) {
    const nextValues = { ...values, [field]: value };
    setValues(nextValues);
    // Once a field has been visited, keep its message current as they type —
    // the error clears the moment the input becomes valid.
    if (touched[field]) {
      setErrors((prev) => ({ ...prev, [field]: validate(nextValues)[field] }));
    }
  }

  function handleBlur(field: Field) {
    setTouched((prev) => ({ ...prev, [field]: true }));
    setErrors((prev) => ({ ...prev, [field]: validate(values)[field] }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(undefined);

    const parsed = signupSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(validate(values)); // surface every field's guidance at once
      setTouched(ALL_TOUCHED);
      return;
    }

    setLoading(true);
    try {
      await signup(parsed.data);
      // The isAuthenticated redirect above takes over on re-render.
    } catch (error) {
      if (!(error instanceof ApiError)) {
        setFormError(messageFor('INTERNAL_ERROR'));
        return;
      }
      if (error.code === 'DUPLICATE_EMAIL') {
        setErrors((prev) => ({ ...prev, email: 'That email is already registered.' }));
        setTouched((prev) => ({ ...prev, email: true }));
        return;
      }
      // Server-side validation: show its authoritative reasons — on the fields
      // when they name a field, otherwise concretely in the banner. Never leave
      // the user with a bare "fix the fields" and nothing to act on.
      if (error.code === 'VALIDATION_ERROR') {
        const fieldErrors = fieldErrorsFromDetails(error.details);
        if (fieldErrors) {
          setErrors((prev) => ({ ...prev, ...fieldErrors }));
          setTouched(ALL_TOUCHED);
          return;
        }
        const messages = detailMessages(error.details);
        setFormError(messages.length > 0 ? messages.join(' ') : messageFor(error.code));
        return;
      }
      setFormError(messageFor(error.code));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
          Create your workspace
        </h1>
        <p className="text-sm text-neutral-500">
          Free to start, no card required. You'll be the first Admin.
        </p>
      </header>
      {formError && <AlertBanner tone="danger" message={formError} />}
      <form onSubmit={(event) => void handleSubmit(event)} noValidate className="space-y-2">
        <FormField
          label="Organization name"
          htmlFor="signup-org"
          error={errors.organizationName}
          hint="The name of your business or team — you can change it later."
          required
        >
          <Input
            autoComplete="organization"
            value={values.organizationName}
            onChange={(e) => setField('organizationName', e.target.value)}
            onBlur={() => handleBlur('organizationName')}
            {...fieldAria(
              'signup-org',
              errors.organizationName,
              'The name of your business or team — you can change it later.',
            )}
          />
        </FormField>
        <FormField label="Your name" htmlFor="signup-name" error={errors.name} required>
          <Input
            autoComplete="name"
            value={values.name}
            onChange={(e) => setField('name', e.target.value)}
            onBlur={() => handleBlur('name')}
            {...fieldAria('signup-name', errors.name)}
          />
        </FormField>
        <FormField label="Email" htmlFor="signup-email" error={errors.email} required>
          <Input
            type="email"
            autoComplete="email"
            value={values.email}
            onChange={(e) => setField('email', e.target.value)}
            onBlur={() => handleBlur('email')}
            {...fieldAria('signup-email', errors.email)}
          />
        </FormField>
        <FormField
          label="Password"
          htmlFor="signup-password"
          error={errors.password}
          hint={PASSWORD_HINT}
          required
        >
          <Input
            type="password"
            autoComplete="new-password"
            value={values.password}
            onChange={(e) => setField('password', e.target.value)}
            onBlur={() => handleBlur('password')}
            {...fieldAria('signup-password', errors.password, PASSWORD_HINT)}
          />
          <PasswordRules value={values.password} />
        </FormField>
        <SubmitRow submitLabel="Create workspace" loading={loading} fullWidth />
      </form>
      <GoogleSignInButton text="signup_with" />
      <p className="text-center text-sm text-neutral-500">
        Already have an account?{' '}
        <Link to="/login" className="font-semibold text-brand-600 hover:text-brand-700">
          Sign in
        </Link>
      </p>
    </div>
  );
}
