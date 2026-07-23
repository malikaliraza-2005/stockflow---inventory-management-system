/**
 * FormField — UCA §3.1: THE only way inputs appear in forms. Owns the
 * `aria-describedby` wiring; error text lives in a live region (WCAG AA,
 * NFR-30). Children receive id/aria props via standard cloning contract:
 * callers pass `htmlFor` matching their input id.
 */
import type { ReactNode } from 'react';

export interface FormFieldProps {
  label: string;
  htmlFor: string;
  error?: string | undefined;
  hint?: string | undefined;
  required?: boolean;
  children: ReactNode;
}

export function FormField({ label, htmlFor, error, hint, required, children }: FormFieldProps) {
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;

  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-700">
        {label}
        {required && (
          <span aria-hidden="true" className="text-danger-600">
            {' '}
            *
          </span>
        )}
      </label>
      {children}
      {hint && (
        <p id={hintId} className="text-xs text-gray-500">
          {hint}
        </p>
      )}
      <p id={errorId} role="alert" aria-live="polite" className="min-h-4 text-xs text-danger-600">
        {error ?? ''}
      </p>
    </div>
  );
}

/** aria helper: spread into the input this field labels. */
export function fieldAria(htmlFor: string, error?: string | undefined, hint?: string | undefined) {
  const describedBy = [hint ? `${htmlFor}-hint` : null, error ? `${htmlFor}-error` : null]
    .filter(Boolean)
    .join(' ');
  return {
    id: htmlFor,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy || undefined,
  };
}
