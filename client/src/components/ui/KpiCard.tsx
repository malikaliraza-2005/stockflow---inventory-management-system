/**
 * KpiCard — UCA §3.2 (F9, first consumer). A single headline metric: a label,
 * a large value, and an optional hint line. Domain-blind and presentational —
 * the Dashboard composes three (total products · inventory value · units in
 * stock, WIR §4). `loading` renders a value skeleton so the card keeps its box
 * (no layout shift, FEA §8).
 */
import type { ReactNode } from 'react';

import { Skeleton } from './Skeleton';

export interface KpiCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  loading?: boolean;
}

export function KpiCard({ label, value, hint, loading = false }: KpiCardProps) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-neutral-200 bg-white p-5 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-soft">
      {/* Decorative brand accent — subtle depth, brightens on hover */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-brand-50 opacity-70 transition-opacity duration-200 group-hover:opacity-100"
      />
      <p className="relative text-xs font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </p>
      {loading ? (
        <Skeleton className="mt-3 h-9 w-28" />
      ) : (
        <p className="relative mt-1.5 text-3xl font-bold tracking-tight text-neutral-900">
          {value}
        </p>
      )}
      {hint && <p className="relative mt-1 text-xs text-neutral-500">{hint}</p>}
    </div>
  );
}
