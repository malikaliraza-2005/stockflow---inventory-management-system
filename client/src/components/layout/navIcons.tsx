/**
 * Nav icons — one minimal inline SVG per sidebar/bottom-bar entry, keyed by
 * route path. Hand-rolled stroke icons (no icon library — FEA §3.1 no extra
 * deps); they inherit color via `currentColor` and size via the className.
 */
import type { ReactNode } from 'react';

function Icon({ d }: { d: string }): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-5 w-5"
    >
      <path d={d} />
    </svg>
  );
}

/** Route path → icon. Keys mirror AppShell's NAV_ENTRIES `to`. */
export const NAV_ICONS: Record<string, ReactNode> = {
  '/dashboard': (
    <Icon d="M4 5.5A1.5 1.5 0 0 1 5.5 4h3A1.5 1.5 0 0 1 10 5.5v3A1.5 1.5 0 0 1 8.5 10h-3A1.5 1.5 0 0 1 4 8.5v-3Zm10 0A1.5 1.5 0 0 1 15.5 4h3A1.5 1.5 0 0 1 20 5.5v3a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 14 8.5v-3Zm-10 10A1.5 1.5 0 0 1 5.5 14h3A1.5 1.5 0 0 1 10 15.5v3A1.5 1.5 0 0 1 8.5 20h-3A1.5 1.5 0 0 1 4 18.5v-3Zm10 0a1.5 1.5 0 0 1 1.5-1.5h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3a1.5 1.5 0 0 1-1.5-1.5v-3Z" />
  ),
  '/products': (
    <Icon d="M3.75 7.5 12 3l8.25 4.5m-16.5 0L12 12m-8.25-4.5v9L12 21m8.25-13.5L12 12m8.25-4.5v9L12 21m0-9v9" />
  ),
  '/scanner': (
    <Icon d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8m8 0h2.5A1.5 1.5 0 0 1 20 5.5V8m0 8v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16m0-4h16" />
  ),
  '/categories': (
    <Icon d="M4 6.5A1.5 1.5 0 0 1 5.5 5h4.6a1.5 1.5 0 0 1 1.06.44l7.4 7.4a1.5 1.5 0 0 1 0 2.12l-4.6 4.6a1.5 1.5 0 0 1-2.12 0l-7.4-7.4A1.5 1.5 0 0 1 4 10.6V6.5Zm3.5 1.5h.01" />
  ),
  '/transactions': <Icon d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  // Speech bubble with a magnifier — it searches inventory, it does not chat.
  '/assistant': (
    <Icon d="M20 12a7 7 0 0 1-7 7H8.5L4 21.5V12a7 7 0 0 1 7-7h2a7 7 0 0 1 7 7Zm-8.6 0a2.1 2.1 0 1 0 4.2 0 2.1 2.1 0 0 0-4.2 0Zm3.6 1.6 1.6 1.6" />
  ),
  '/reports': <Icon d="M4 20V13m5 7V8m5 12v-5m5 5V5" />,
  '/users': (
    <Icon d="M15 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1m18 0v-1a4 4 0 0 0-3-3.87M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7-1a3 3 0 1 0-1.5-5.6" />
  ),
  '/settings': (
    <Icon d="M10.34 4.06a1 1 0 0 1 .97-.76h1.38a1 1 0 0 1 .97.76l.28 1.14a7 7 0 0 1 1.3.75l1.12-.4a1 1 0 0 1 1.2.45l.7 1.2a1 1 0 0 1-.23 1.27l-.9.74a7 7 0 0 1 0 1.5l.9.74a1 1 0 0 1 .23 1.27l-.7 1.2a1 1 0 0 1-1.2.45l-1.12-.4a7 7 0 0 1-1.3.75l-.28 1.14a1 1 0 0 1-.97.76h-1.38a1 1 0 0 1-.97-.76l-.28-1.14a7 7 0 0 1-1.3-.75l-1.12.4a1 1 0 0 1-1.2-.45l-.7-1.2a1 1 0 0 1 .23-1.27l.9-.74a7 7 0 0 1 0-1.5l-.9-.74a1 1 0 0 1-.23-1.27l.7-1.2a1 1 0 0 1 1.2-.45l1.12.4a7 7 0 0 1 1.3-.75l.28-1.14ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
  ),
};
