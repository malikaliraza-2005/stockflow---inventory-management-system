/** Pagination — UCA §3.2 (first consumer F2): `page, totalPages, onChange` +
 *  "Showing a–b of n". Page state lives in the URL (SMA §2). */
import { Button } from './Button';

export interface PaginationProps {
  page: number;
  totalPages: number;
  totalItems: number;
  limit: number;
  onChange: (page: number) => void;
}

export function Pagination({ page, totalPages, totalItems, limit, onChange }: PaginationProps) {
  if (totalItems === 0) return null;
  const first = (page - 1) * limit + 1;
  const last = Math.min(page * limit, totalItems);

  return (
    <div className="flex items-center justify-between gap-3 pt-3 text-sm text-gray-600">
      <span>
        Showing {first}–{last} of {totalItems}
      </span>
      <div className="flex items-center gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          Previous
        </Button>
        <span aria-current="page">
          Page {page} of {totalPages}
        </span>
        <Button
          variant="secondary"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
