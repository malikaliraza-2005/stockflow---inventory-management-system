/** AlertBanner — UCA §3.2: `tone, message, action?` (invalid reset token
 *  in-page state, STALE_WRITE, archived banner, maintenance). */
import type { ReactNode } from 'react';

const toneClasses = {
  info: 'bg-brand-50 text-brand-700 border-brand-100',
  warning: 'bg-warning-100 text-warning-700 border-warning-100',
  danger: 'bg-danger-100 text-danger-600 border-danger-100',
} as const;

export function AlertBanner({
  tone = 'info',
  message,
  action,
}: {
  tone?: keyof typeof toneClasses;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={`flex items-center justify-between gap-3 rounded-md border px-4 py-3 text-sm ${toneClasses[tone]}`}
    >
      <span>{message}</span>
      {action}
    </div>
  );
}
