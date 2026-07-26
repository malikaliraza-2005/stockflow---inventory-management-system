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
    'bg-linear-to-b from-brand-500 to-brand-600 text-white shadow-sm hover:from-brand-600 hover:to-brand-700 hover:shadow active:from-brand-700 active:to-brand-800 disabled:from-brand-500/50 disabled:to-brand-500/50 disabled:shadow-none',
  secondary:
    'border border-neutral-300 bg-white text-neutral-800 shadow-xs hover:border-neutral-400 hover:bg-neutral-50 active:bg-neutral-100 disabled:opacity-50',
  danger:
    'bg-danger-600 text-white shadow-sm hover:bg-danger-700 hover:shadow active:bg-danger-700 disabled:opacity-50 disabled:shadow-none',
  ghost: 'text-neutral-700 hover:bg-neutral-100 active:bg-neutral-200 disabled:opacity-50',
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
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:active:translate-y-0 ${variantClasses[variant]} ${className}`}
      {...rest}
    >
      {loading && <Spinner size="sm" />}
      {children}
    </button>
  );
}
