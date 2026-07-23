/**
 * Button — UCA §3.2: variants primary|secondary|danger|ghost; `loading`
 * disables and shows a spinner. Domain-blind. Variants via plain class-map
 * composition (FEA §3.1 — no styling libraries).
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const variantClasses: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-500/50',
  secondary: 'border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 disabled:opacity-50',
  danger: 'bg-danger-600 text-white hover:bg-red-700 disabled:opacity-50',
  ghost: 'text-gray-700 hover:bg-gray-100 disabled:opacity-50',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  loading = false,
  disabled,
  children,
  type = 'button',
  className = '',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${variantClasses[variant]} ${className}`}
      {...rest}
    >
      {loading && <Spinner size="sm" />}
      {children}
    </button>
  );
}
