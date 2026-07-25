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
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-sm text-gray-600">{label}</p>
      {loading ? (
        <Skeleton className="mt-2 h-8 w-24" />
      ) : (
        <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
      )}
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}
