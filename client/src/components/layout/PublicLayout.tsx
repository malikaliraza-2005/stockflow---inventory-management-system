/**
 * PublicLayout — SMP §1: the auth chrome for /login, /signup and
 * /reset-password. A two-column split: a dark brand panel carrying the same
 * aurora treatment as the marketing hero (desktop only — it is decorative, so
 * it simply disappears under lg rather than stacking), and the form column,
 * which is the whole screen on mobile.
 *
 * The panel's headline follows the route, so arriving from "Get started" reads
 * as a continuation of that click rather than a generic login wall. Everything
 * else — the form, its validation, its errors — lives in the page.
 */
import { Link, Outlet, useLocation } from 'react-router-dom';

import { Logo } from '../ui/Logo';

interface PanelCopy {
  eyebrow: string;
  title: string;
  body: string;
  points: readonly string[];
}

const DEFAULT_COPY: PanelCopy = {
  eyebrow: 'Welcome back',
  title: 'Your stockroom, exactly as you left it.',
  body: 'Every count, movement and adjustment your team made while you were away — already reconciled.',
  points: ['Live stock levels', 'Barcode scanning', 'Complete audit trail'],
};

const COPY_BY_PATH: Record<string, PanelCopy> = {
  '/signup': {
    eyebrow: 'Set up in under a minute',
    title: 'Start counting once, not three times.',
    body: 'Create your workspace, load your catalog, and let the ledger keep itself honest from the first scan.',
    points: ['Free to start — no card', 'Your data, isolated', 'Invite your team in a click'],
  },
  '/reset-password': {
    eyebrow: 'Security',
    title: 'Pick a password worth keeping.',
    body: 'Reset links are single-use and expire — once this one is spent, the account is yours again.',
    points: [
      'Single-use reset link',
      'Passwords never stored in the clear',
      'Every change audit-logged',
    ],
  },
};

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-3.5 w-3.5"
    >
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

export function PublicLayout() {
  const { pathname } = useLocation();
  const copy = COPY_BY_PATH[pathname] ?? DEFAULT_COPY;

  return (
    <div className="flex min-h-screen bg-white">
      {/* ── Brand panel (lg+) ─────────────────────────────────────────────── */}
      <aside className="relative isolate hidden w-[44%] max-w-2xl shrink-0 overflow-hidden bg-neutral-900 text-white lg:block">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-linear-to-b from-brand-800 via-brand-900 to-neutral-900" />
          <div className="animate-aurora absolute -top-32 -left-24 h-120 w-120 rounded-full bg-brand-500/30 blur-[110px]" />
          <div
            className="animate-aurora absolute -right-32 -bottom-24 h-104 w-104 rounded-full bg-fuchsia-500/20 blur-[110px]"
            style={{ animationDelay: '-9s' }}
          />
          <div className="hero-grid absolute inset-0" />
        </div>

        <div className="flex h-full flex-col justify-between p-12 xl:p-16">
          <Link to="/" className="w-fit rounded-md focus-visible:outline-none">
            <Logo wordmarkClassName="text-xl font-semibold text-white" />
          </Link>

          <div className="animate-rise-in max-w-md">
            <p className="text-xs font-semibold tracking-[0.2em] text-brand-200/80 uppercase">
              {copy.eyebrow}
            </p>
            <h2 className="mt-4 text-3xl font-bold tracking-tight text-balance xl:text-4xl">
              {copy.title}
            </h2>
            <p className="mt-4 text-pretty text-brand-100/75">{copy.body}</p>
            <ul className="mt-8 space-y-3 text-sm text-brand-100/90">
              {copy.points.map((point) => (
                <li key={point} className="flex items-center gap-3">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/10 text-brand-200 ring-1 ring-white/15">
                    <CheckIcon />
                  </span>
                  {point}
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs text-brand-100/40">© StockFlow — Inventory Management System</p>
        </div>
      </aside>

      {/* ── Form column ──────────────────────────────────────────────────── */}
      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          {/* The panel carries the brand on desktop; on mobile the form column
              has to do it itself. */}
          <div className="mb-8 flex justify-center lg:hidden">
            <Link to="/" className="rounded-md focus-visible:outline-none">
              <Logo />
            </Link>
          </div>

          {/* A card on mobile (it needs edges against the page); on desktop the
              column IS the surface, so the chrome drops away. */}
          <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-soft sm:p-8 lg:border-0 lg:p-0 lg:shadow-none">
            <Outlet />
          </div>

          <p className="mt-8 text-center text-xs text-neutral-400 lg:hidden">
            © StockFlow — Inventory Management System
          </p>
        </div>
      </main>
    </div>
  );
}
