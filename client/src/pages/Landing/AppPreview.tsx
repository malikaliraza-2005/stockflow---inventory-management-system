/**
 * AppPreview — the hero's product shot: a miniature, hand-built replica of the
 * StockFlow dashboard (rail + KPI tiles + movement chart + stock list). Static
 * markup on purpose — no data fetch, no shared app components — so the public
 * landing chunk never pulls the authenticated app's code (SMP §7) and the
 * numbers can be tuned for the story rather than the seed data.
 *
 * Entirely decorative: aria-hidden, so screen readers hear the hero copy and
 * skip the picture of an app they cannot use yet.
 */

const KPIS = [
  { label: 'Total products', value: '1,284', delta: '+38', tone: 'text-success-600' },
  { label: 'Low stock', value: '12', delta: '−4', tone: 'text-warning-700' },
  { label: 'Moves today', value: '148', delta: '+22', tone: 'text-success-600' },
];

/** Relative bar heights for the 12-slot movement chart (percent). */
const BARS = [38, 52, 44, 68, 58, 82, 64, 92, 74, 86, 96, 70];

const ROWS = [
  { sku: 'SKU-4021', name: 'Thermal label roll', qty: '412', state: 'In stock' as const },
  { sku: 'SKU-1188', name: 'Barcode scanner v2', qty: '9', state: 'Low' as const },
  { sku: 'SKU-7734', name: 'Shelf divider (pk 10)', qty: '0', state: 'Out' as const },
];

const STATE_CLASSES: Record<(typeof ROWS)[number]['state'], string> = {
  'In stock': 'bg-success-100 text-success-600',
  Low: 'bg-warning-100 text-warning-700',
  Out: 'bg-danger-100 text-danger-600',
};

export function AppPreview() {
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-2xl bg-white shadow-pop ring-1 ring-neutral-900/10 select-none"
    >
      {/* Window chrome */}
      <div className="flex items-center gap-2 border-b border-neutral-200 bg-neutral-50 px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-danger-600/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-warning-700/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-success-600/60" />
        <span className="ml-3 hidden rounded-md bg-white px-3 py-1 text-[11px] font-medium text-neutral-400 ring-1 ring-neutral-200 sm:block">
          app.stockflow.io/dashboard
        </span>
      </div>

      <div className="flex">
        {/* Sidebar rail — the real AppShell nav, abstracted to pills */}
        <div className="hidden w-14 shrink-0 flex-col items-center gap-3 border-r border-neutral-200 bg-neutral-50/70 py-4 sm:flex">
          <span className="h-6 w-6 rounded-lg bg-linear-to-b from-brand-500 to-brand-800" />
          <span className="mt-2 h-6 w-6 rounded-md bg-brand-100" />
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="h-6 w-6 rounded-md bg-neutral-200/80" />
          ))}
        </div>

        <div className="min-w-0 flex-1 p-4 md:p-5">
          {/* KPI row */}
          <div className="grid grid-cols-3 gap-2 md:gap-3">
            {KPIS.map((k) => (
              <div key={k.label} className="rounded-xl border border-neutral-200 p-3 shadow-card">
                <p className="truncate text-[10px] font-medium tracking-wide text-neutral-500 uppercase">
                  {k.label}
                </p>
                <p className="mt-1 text-lg font-semibold text-neutral-900 md:text-xl">{k.value}</p>
                <p className={`text-[10px] font-semibold ${k.tone}`}>{k.delta} this week</p>
              </div>
            ))}
          </div>

          {/* Movement chart */}
          <div className="mt-3 rounded-xl border border-neutral-200 p-3 shadow-card md:mt-4">
            <div className="flex items-baseline justify-between">
              <p className="text-xs font-semibold text-neutral-800">Stock movements</p>
              <p className="text-[10px] text-neutral-400">Last 12 days</p>
            </div>
            <div className="mt-3 flex h-20 items-end gap-1 md:h-24 md:gap-1.5">
              {BARS.map((h, i) => (
                <span
                  key={i}
                  style={{ height: `${h}%` }}
                  className={`flex-1 rounded-t-[3px] ${
                    i === BARS.length - 2
                      ? 'bg-linear-to-t from-brand-600 to-brand-400'
                      : 'bg-linear-to-t from-brand-200 to-brand-100'
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Stock list */}
          <div className="mt-3 divide-y divide-neutral-100 rounded-xl border border-neutral-200 shadow-card md:mt-4">
            {ROWS.map((r) => (
              <div key={r.sku} className="flex items-center gap-3 px-3 py-2.5">
                <span className="h-7 w-7 shrink-0 rounded-md bg-neutral-100" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-neutral-800">{r.name}</p>
                  <p className="text-[10px] text-neutral-400">{r.sku}</p>
                </div>
                <span className="text-xs font-semibold text-neutral-700 tabular-nums">{r.qty}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATE_CLASSES[r.state]}`}
                >
                  {r.state}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
