/**
 * ChartPanel — WIR §4 (F9). The two dashboard charts: movement trend (in vs out)
 * and transaction volume, over the selected 7/30/90-day window (FR-DASH-02).
 *
 * Recharts' FIRST and only consumer (IMP-020 §2-F9). This module is loaded via
 * React.lazy from the Dashboard so the ~heavy chart bundle NEVER enters the
 * login/initial paint (NFR-06 / R-5 chart-bundle discipline) — it hydrates after
 * the shell. Default-exported for React.lazy. Purely presentational: the series
 * arrive already gap-filled per UTC day by the single aggregate call.
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { MovementTrendPoint, TransactionVolumePoint } from '../../api/dashboard';

export interface ChartPanelProps {
  movementTrend: MovementTrendPoint[];
  transactionVolume: TransactionVolumePoint[];
}

/** YYYY-MM-DD → MM-DD tick (compact axis). */
function shortDay(date: string): string {
  return date.slice(5);
}

export default function ChartPanel({ movementTrend, transactionVolume }: ChartPanelProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <figure className="rounded-lg border border-gray-200 bg-white p-4">
        <figcaption className="mb-2 text-sm font-semibold text-gray-900">
          Movement trend (in vs out)
        </figcaption>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={movementTrend} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="date" tickFormatter={shortDay} fontSize={11} />
            <YAxis allowDecimals={false} fontSize={11} width={32} />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="in" name="In" stroke="#16a34a" dot={false} />
            <Line type="monotone" dataKey="out" name="Out" stroke="#dc2626" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </figure>

      <figure className="rounded-lg border border-gray-200 bg-white p-4">
        <figcaption className="mb-2 text-sm font-semibold text-gray-900">
          Transaction volume
        </figcaption>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={transactionVolume} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="date" tickFormatter={shortDay} fontSize={11} />
            <YAxis allowDecimals={false} fontSize={11} width={32} />
            <Tooltip />
            <Bar dataKey="count" name="Transactions" fill="#2563eb" />
          </BarChart>
        </ResponsiveContainer>
      </figure>
    </div>
  );
}
