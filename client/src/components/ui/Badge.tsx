/** Badge — UCA §3.2: generic `tone + text`, DOMAIN-BLIND (review Issue 1 —
 *  StockStatusBadge etc. are domain components that compose this). Color is
 *  never the sole signal (NFR-30): the text always carries the meaning. */
import type { ReactNode } from 'react';

const toneClasses = {
  neutral: 'bg-neutral-100 text-neutral-700 ring-neutral-200',
  success: 'bg-success-100 text-success-600 ring-success-600/20',
  warning: 'bg-warning-100 text-warning-700 ring-warning-700/20',
  danger: 'bg-danger-100 text-danger-600 ring-danger-600/20',
} as const;

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: keyof typeof toneClasses;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${toneClasses[tone]}`}
    >
      {children}
    </span>
  );
}
