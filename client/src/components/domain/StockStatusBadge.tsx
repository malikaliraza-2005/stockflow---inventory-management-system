/**
 * StockStatusBadge — UCA §5 (domain, F4). Maps the derived stock status onto
 * the domain-blind Badge; an archived product reads "Archived" regardless of
 * quantity (WIR badge semantics). Text always carries the meaning (NFR-30).
 */
import type { StockStatus } from '../../api/products';
import { Badge } from '../ui/Badge';

const STATUS: Record<StockStatus, { tone: 'success' | 'warning' | 'danger'; label: string }> = {
  IN_STOCK: { tone: 'success', label: 'In stock' },
  LOW_STOCK: { tone: 'warning', label: 'Low stock' },
  OUT_OF_STOCK: { tone: 'danger', label: 'Out of stock' },
};

export interface StockStatusBadgeProps {
  status: StockStatus;
  isArchived?: boolean;
}

export function StockStatusBadge({ status, isArchived = false }: StockStatusBadgeProps) {
  if (isArchived) return <Badge tone="neutral">Archived</Badge>;
  const { tone, label } = STATUS[status];
  return <Badge tone={tone}>{label}</Badge>;
}
