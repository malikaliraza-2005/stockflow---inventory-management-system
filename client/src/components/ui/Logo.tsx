/**
 * Logo — the StockFlow brand lockup: a badge mark (three ascending "stock"
 * boxes flowing upward) beside the wordmark. Single source of truth for the
 * brand identity across every layout (PublicLayout, AppShell, MarketingLayout);
 * the mark mirrors /public/favicon.svg exactly. Pass showWordmark={false} for
 * the mark alone (e.g. a collapsed sidebar or a footer).
 *
 * The gradient id is per-instance (useId) so multiple logos on one page — the
 * sidebar and the mobile top bar both live in the AppShell DOM — never collide.
 */
import { useId } from 'react';

export interface LogoProps {
  showWordmark?: boolean;
  className?: string;
  markClassName?: string;
  wordmarkClassName?: string;
}

export function Logo({
  showWordmark = true,
  className = '',
  markClassName = 'h-7 w-7',
  wordmarkClassName = 'text-xl font-semibold text-brand-700',
}: LogoProps) {
  const gradientId = useId();
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg
        viewBox="0 0 32 32"
        className={markClassName}
        {...(showWordmark ? { 'aria-hidden': true } : { role: 'img', 'aria-label': 'StockFlow' })}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8b5cf6" />
            <stop offset="1" stopColor="#5b21b6" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="7" fill={`url(#${gradientId})`} />
        <g fill="#ffffff">
          <rect x="6" y="18" width="8" height="8" rx="2" opacity="0.55" />
          <rect x="12" y="12" width="8" height="8" rx="2" opacity="0.78" />
          <rect x="18" y="6" width="8" height="8" rx="2" />
        </g>
      </svg>
      {showWordmark && <span className={wordmarkClassName}>StockFlow</span>}
    </span>
  );
}
