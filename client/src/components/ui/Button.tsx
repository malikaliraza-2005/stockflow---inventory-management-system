/**
 * Button — UCA §3.2: variants primary|secondary|danger|ghost; `loading`
 * disables and shows a spinner. Domain-blind. Variants via plain class-map
 * composition (FEA §3.1 — no styling libraries).
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const variantClasses: Record<Variant, string> = {
  primary:
    'bg-brand-600 text-white shadow-sm hover:bg-brand-700 hover:shadow active:bg-brand-800 disabled:bg-brand-500/50 disabled:shadow-none',
  secondary:
    'border border-gray-300 bg-white text-gray-800 hover:border-gray-400 hover:bg-gray-50 active:bg-gray-100 disabled:opacity-50',
  danger:
    'bg-danger-600 text-white shadow-sm hover:bg-danger-700 hover:shadow active:bg-danger-700 disabled:opacity-50 disabled:shadow-none',
  ghost: 'text-gray-700 hover:bg-gray-100 active:bg-gray-200 disabled:opacity-50',
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
      className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-all duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:active:translate-y-0 ${variantClasses[variant]} ${className}`}
      {...rest}
    >
      {loading && <Spinner size="sm" />}
      {children}
    </button>
  );
}
