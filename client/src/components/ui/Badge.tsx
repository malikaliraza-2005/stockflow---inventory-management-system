/** Badge — UCA §3.2: generic `tone + text`, DOMAIN-BLIND (review Issue 1 —
 *  StockStatusBadge etc. are domain components that compose this). Color is
 *  never the sole signal (NFR-30): the text always carries the meaning. */
import type { ReactNode } from 'react';

const toneClasses = {
  neutral: 'bg-gray-100 text-gray-700',
  success: 'bg-success-100 text-success-600',
  warning: 'bg-warning-100 text-warning-700',
  danger: 'bg-danger-100 text-danger-600',
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
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${toneClasses[tone]}`}
    >
      {children}
    </span>
  );
}
