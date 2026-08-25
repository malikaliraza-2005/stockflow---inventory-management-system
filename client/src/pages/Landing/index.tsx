/** Landing — public marketing home (SMP §2.1). Static; no data fetch. A dark
 *  aurora hero with a product shot, a capability strip, a bento feature grid,
 *  a three-step walkthrough and a closing CTA. Rendered inside MarketingLayout,
 *  whose header floats transparently over this hero.
 *
 *  Motion is all decorative and defined in index.css (`animate-rise-in`,
 *  `animate-aurora`, `animate-float-y`, `animate-sheen`) — every one of them is
 *  disabled under prefers-reduced-motion, and nothing here depends on it.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { AppPreview } from './AppPreview';

/* ── Icons ───────────────────────────────────────────────────────────────
   Hand-rolled strokes, matching navIcons.tsx (FEA §3.1 — no icon library). */
function Icon({ d, className = 'h-5 w-5' }: { d: string; className?: string }): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d={d} />
    </svg>
  );
}

const PATHS = {
  boxes:
    'M3.75 7.5 12 3l8.25 4.5m-16.5 0L12 12m-8.25-4.5v9L12 21m8.25-13.5L12 12m8.25-4.5v9L12 21m0-9v9',
  scan: 'M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8m8 0h2.5A1.5 1.5 0 0 1 20 5.5V8m0 8v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16m0-4h16',
  spark:
    'M12 3v3m0 12v3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M3 12h3m12 0h3M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z',
  chart: 'M4 20V13m5 7V8m5 12v-5m5 5V5',
  shield: 'M12 3 5 6v6c0 4 3 7.2 7 9 4-1.8 7-5 7-9V6l-7-3Zm-2.5 8.5 1.8 1.8 3.4-3.4',
  users:
    'M15 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1m18 0v-1a4 4 0 0 0-3-3.87M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7-1a3 3 0 1 0-1.5-5.6',
  bolt: 'M13 3 5 14h6l-1 7 8-11h-6l1-7Z',
  check: 'm5 12.5 4.5 4.5L19 7.5',
} as const;

/* ── Content ─────────────────────────────────────────────────────────────
   Claims describe what the product actually ships (F6–F11) — no invented
   customer counts or testimonials. */

const CAPABILITIES = [
  { value: '3', label: 'roles, permission-gated' },
  { value: '100%', label: 'of changes audit-logged' },
  { value: '<1s', label: 'search across the catalog' },
  { value: '0', label: 'extra hardware to scan' },
];

const FEATURES = [
  {
    icon: PATHS.boxes,
    title: 'Real-time inventory',
    body: 'Stock levels, low-stock thresholds and every movement across your catalog, reconciled in one ledger.',
  },
  {
    icon: PATHS.scan,
    title: 'Barcode scanning',
    body: 'Stock in, stock out or adjust straight from the browser camera — no extra hardware, no app store.',
  },
  {
    icon: PATHS.chart,
    title: 'Reports & export',
    body: 'Dashboards for the day-to-day, truncation-proof CSV exports for everything else.',
  },
  {
    icon: PATHS.shield,
    title: 'Complete audit trail',
    body: 'Who changed what, when, and from what to what — every write, permanently traceable.',
  },
  {
    icon: PATHS.users,
    title: 'Roles & permissions',
    body: 'Admin, Manager and Staff, each with a scope that stops at exactly the right place.',
  },
];

const STEPS = [
  {
    n: '01',
    title: 'Create your workspace',
    body: 'Sign up with email or Google. Your data is isolated from every other workspace from the first row written.',
  },
  {
    n: '02',
    title: 'Load your catalog',
    body: 'Add products and categories, set reorder points, print QR labels for the shelves that need them.',
  },
  {
    n: '03',
    title: 'Scan and stay in sync',
    body: 'Your team moves stock with the camera; the ledger, dashboard and audit trail update themselves.',
  },
];

/* ── Page ────────────────────────────────────────────────────────────────── */

export default function Landing() {
  return (
    <>
      {/* ── Hero — dark slab; the marketing header floats over it ─────────── */}
      <section className="relative isolate overflow-hidden bg-neutral-900 text-white">
        {/* Aurora field: two drifting colour blobs + a blueprint grid. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-linear-to-b from-brand-900 via-neutral-900 to-neutral-900" />
          <div className="animate-aurora absolute -top-40 -left-32 h-136 w-136 rounded-full bg-brand-500/30 blur-[110px]" />
          <div
            className="animate-aurora absolute -top-24 -right-40 h-120 w-120 rounded-full bg-fuchsia-500/20 blur-[120px]"
            style={{ animationDelay: '-7s' }}
          />
          <div className="hero-grid absolute inset-0" />
        </div>

        <div className="mx-auto w-full max-w-6xl px-4 pt-32 pb-16 text-center md:px-6 md:pt-40 md:pb-24">
          <p className="animate-rise-in inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-medium text-brand-100 backdrop-blur">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-300 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-300" />
            </span>
            New — ask your inventory a question, in plain English
          </p>

          <h1
            className="animate-rise-in mt-7 text-4xl font-bold tracking-tight text-balance sm:text-5xl md:text-6xl"
            style={{ animationDelay: '90ms' }}
          >
            Know exactly what you have.
            <br />
            <span className="animate-sheen bg-linear-to-r from-brand-200 via-white to-brand-300 bg-clip-text text-transparent">
              Down to the last unit.
            </span>
          </h1>

          <p
            className="animate-rise-in mx-auto mt-6 max-w-2xl text-lg text-pretty text-brand-100/80 md:text-xl"
            style={{ animationDelay: '180ms' }}
          >
            StockFlow tracks stock, scans barcodes and keeps a complete audit trail — in one clean,
            fast workspace your whole team can actually use.
          </p>

          <div
            className="animate-rise-in mt-10 flex flex-wrap items-center justify-center gap-3"
            style={{ animationDelay: '260ms' }}
          >
            <Link
              to="/signup"
              className="group inline-flex items-center gap-2 rounded-xl bg-white px-7 py-3.5 text-sm font-semibold text-brand-800 shadow-pop transition-all duration-200 hover:-translate-y-0.5 hover:bg-brand-50"
            >
              Get started free
              <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">
                →
              </span>
            </Link>
            <Link
              to="/login"
              className="rounded-xl border border-white/25 bg-white/5 px-7 py-3.5 text-sm font-semibold text-white backdrop-blur transition-colors hover:bg-white/15"
            >
              Log in
            </Link>
          </div>

          <p
            className="animate-rise-in mt-6 text-xs text-brand-100/60"
            style={{ animationDelay: '320ms' }}
          >
            Free to start · No credit card · Your workspace is ready in under a minute
          </p>
        </div>

        {/* Product shot — floats out of the hero and onto the section below. */}
        <div className="mx-auto w-full max-w-5xl px-4 md:px-6">
          <div
            className="animate-rise-in relative -mb-24 md:-mb-32"
            style={{ animationDelay: '400ms' }}
          >
            <div
              aria-hidden="true"
              className="absolute -inset-6 -z-10 rounded-4xl bg-brand-500/25 blur-3xl"
            />
            <div className="animate-float-y">
              <AppPreview />
            </div>

            {/* Floating proof chips — the two moments the product is about. */}
            <div
              aria-hidden="true"
              className="animate-float-y absolute -top-5 -left-3 hidden items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-neutral-800 shadow-pop ring-1 ring-neutral-900/5 md:flex"
              style={{ animationDelay: '-2.5s' }}
            >
              <span className="grid h-6 w-6 place-items-center rounded-lg bg-success-100 text-success-600">
                <Icon d={PATHS.check} className="h-3.5 w-3.5" />
              </span>
              Scanned → stocked in
            </div>
            <div
              aria-hidden="true"
              className="animate-float-y absolute -right-3 -bottom-5 hidden items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-neutral-800 shadow-pop ring-1 ring-neutral-900/5 md:flex"
              style={{ animationDelay: '-4.5s' }}
            >
              <span className="grid h-6 w-6 place-items-center rounded-lg bg-brand-100 text-brand-700">
                <Icon d={PATHS.shield} className="h-3.5 w-3.5" />
              </span>
              Audit entry written
            </div>
          </div>
        </div>
      </section>

      {/* ── Capability strip ─────────────────────────────────────────────── */}
      <section className="bg-white pt-32 md:pt-44">
        <div className="mx-auto w-full max-w-6xl px-4 md:px-6">
          <dl className="grid grid-cols-2 gap-6 rounded-2xl border border-neutral-200 bg-neutral-50/60 p-8 md:grid-cols-4">
            {CAPABILITIES.map((c) => (
              <div key={c.label} className="text-center">
                <dt className="sr-only">{c.label}</dt>
                <dd>
                  <span className="block bg-linear-to-b from-brand-600 to-brand-800 bg-clip-text text-3xl font-bold text-transparent md:text-4xl">
                    {c.value}
                  </span>
                  <span className="mt-1 block text-xs text-neutral-500 md:text-sm">{c.label}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ── Features (bento) ─────────────────────────────────────────────── */}
      <section id="features" className="scroll-mt-24 bg-white py-20 md:py-28">
        <div className="mx-auto w-full max-w-6xl px-4 md:px-6">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold tracking-wide text-brand-600 uppercase">
              Everything in one place
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-balance text-neutral-900 md:text-4xl">
              The whole stockroom, on one screen
            </h2>
            <p className="mt-4 text-lg text-pretty text-neutral-600">
              Six features that replace the spreadsheet, the clipboard and the group chat where
              everyone asks whether the last box was counted.
            </p>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {/* Lead card — the AI assistant, spanning two columns */}
            <article className="group relative overflow-hidden rounded-2xl bg-neutral-900 p-8 text-white md:col-span-2">
              <div
                aria-hidden="true"
                className="animate-aurora absolute -top-24 -right-16 h-72 w-72 rounded-full bg-brand-500/40 blur-[80px]"
              />
              <div className="relative">
                <span className="inline-grid h-11 w-11 place-items-center rounded-xl bg-white/10 text-brand-200 ring-1 ring-white/15">
                  <Icon d={PATHS.spark} />
                </span>
                <h3 className="mt-5 text-xl font-semibold">Ask your inventory anything</h3>
                <p className="mt-2 max-w-lg text-sm text-brand-100/75">
                  “Which products are below their reorder point?” “What moved yesterday?” The
                  assistant reads your live data and answers in plain English — read-only, so it can
                  never change a number behind your back.
                </p>
                <div className="mt-6 flex flex-wrap gap-2">
                  {[
                    'Which products are above 10?',
                    'Low stock right now',
                    'Total value on hand',
                  ].map((q) => (
                    <span
                      key={q}
                      className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-brand-100"
                    >
                      {q}
                    </span>
                  ))}
                </div>
              </div>
            </article>

            {FEATURES.map((f) => (
              <article
                key={f.title}
                className="group rounded-2xl border border-neutral-200 bg-white p-7 shadow-card transition-all duration-200 hover:-translate-y-1 hover:border-brand-200 hover:shadow-soft"
              >
                <span className="inline-grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-700 transition-colors group-hover:bg-brand-600 group-hover:text-white">
                  <Icon d={f.icon} />
                </span>
                <h3 className="mt-5 text-lg font-semibold text-neutral-900">{f.title}</h3>
                <p className="mt-2 text-sm text-neutral-600">{f.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section id="how-it-works" className="scroll-mt-24 border-y border-neutral-200 bg-neutral-50">
        <div className="mx-auto w-full max-w-6xl px-4 py-20 md:px-6 md:py-28">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold tracking-wide text-brand-600 uppercase">
              How it works
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-neutral-900 md:text-4xl">
              Counted by Friday. Really.
            </h2>
          </div>

          <ol className="relative mt-12 grid gap-8 md:grid-cols-3">
            {/* Connecting rail behind the numbers (desktop only). */}
            <div
              aria-hidden="true"
              className="absolute top-6 right-0 left-0 hidden h-px bg-linear-to-r from-transparent via-brand-200 to-transparent md:block"
            />
            {STEPS.map((s) => (
              <li key={s.n} className="relative">
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-linear-to-b from-brand-500 to-brand-700 text-sm font-bold text-white shadow-soft">
                  {s.n}
                </span>
                <h3 className="mt-5 text-lg font-semibold text-neutral-900">{s.title}</h3>
                <p className="mt-2 text-sm text-neutral-600">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Closing CTA ──────────────────────────────────────────────────── */}
      <section className="bg-white px-4 py-20 md:px-6 md:py-28">
        <div className="relative isolate mx-auto w-full max-w-5xl overflow-hidden rounded-3xl bg-neutral-900 px-6 py-16 text-center md:px-12 md:py-20">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
            <div className="absolute inset-0 bg-linear-to-br from-brand-800 via-brand-900 to-neutral-900" />
            <div className="animate-aurora absolute -bottom-32 left-1/4 h-96 w-96 rounded-full bg-brand-400/30 blur-[100px]" />
            <div className="hero-grid absolute inset-0" />
          </div>

          <span className="inline-grid h-12 w-12 place-items-center rounded-2xl bg-white/10 text-brand-200 ring-1 ring-white/15">
            <Icon d={PATHS.bolt} className="h-6 w-6" />
          </span>
          <h2 className="mt-6 text-3xl font-bold tracking-tight text-balance text-white md:text-4xl">
            Ready to stop guessing?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-pretty text-brand-100/80">
            Create your workspace in under a minute — then scan your first item before the kettle
            boils.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/signup"
              className="group inline-flex items-center gap-2 rounded-xl bg-white px-7 py-3.5 text-sm font-semibold text-brand-800 shadow-pop transition-all duration-200 hover:-translate-y-0.5 hover:bg-brand-50"
            >
              Create your workspace
              <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">
                →
              </span>
            </Link>
            <Link
              to="/login"
              className="rounded-xl border border-white/25 px-7 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              I already have an account
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
