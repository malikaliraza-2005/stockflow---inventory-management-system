/** Landing — public marketing home (SMP §2.1). Static; no data fetch. Hero +
 *  feature triplet + closing CTA. Rendered inside MarketingLayout. */
import { Link } from 'react-router-dom';

const FEATURES = [
  {
    title: 'Real-time inventory',
    body: 'Track stock levels, low-stock thresholds, and every movement across your catalog in one ledger.',
  },
  {
    title: 'Barcode scanning',
    body: 'Scan to stock in, stock out, or adjust — straight from the browser, no extra hardware.',
  },
  {
    title: 'Reports & audit trail',
    body: 'Export truncation-proof CSVs and trace every change through a complete, tamper-evident audit log.',
  },
];

export default function Landing() {
  return (
    <>
      {/* Hero */}
      <section className="bg-linear-to-b from-brand-800 to-brand-900 text-white">
        <div className="mx-auto w-full max-w-4xl px-4 py-20 text-center md:px-6 md:py-28">
          <h1 className="text-4xl font-bold tracking-tight md:text-5xl">
            Inventory management that keeps up with your team
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-brand-100">
            StockFlow tracks stock, scans barcodes, and gives you a complete audit trail — in one
            clean, fast workspace.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link
              to="/signup"
              className="rounded-md bg-white px-6 py-3 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50"
            >
              Get started free
            </Link>
            <Link
              to="/login"
              className="rounded-md border border-white/40 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              Log in
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto w-full max-w-6xl px-4 py-20 md:px-6">
        <div className="grid gap-8 md:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-lg border border-neutral-200 bg-white p-6 transition-all duration-200 hover:-translate-y-1 hover:border-brand-200 hover:shadow-lg"
            >
              <h2 className="text-lg font-semibold text-neutral-900">{f.title}</h2>
              <p className="mt-2 text-sm text-neutral-600">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Closing CTA */}
      <section className="border-t border-neutral-200 bg-neutral-50">
        <div className="mx-auto w-full max-w-4xl px-4 py-16 text-center md:px-6">
          <h2 className="text-2xl font-bold text-neutral-900">Ready to get organized?</h2>
          <p className="mt-3 text-neutral-600">Create your workspace in under a minute.</p>
          <Link
            to="/signup"
            className="mt-8 inline-block rounded-md bg-brand-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
          >
            Create your workspace
          </Link>
        </div>
      </section>
    </>
  );
}
