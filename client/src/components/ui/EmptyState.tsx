/** EmptyState — UCA §3.2: `message, action?`. Every list has a designed empty
 *  state with the role-appropriate CTA (FEA §8). */
import type { ReactNode } from 'react';

export function EmptyState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-gray-300 py-12 text-center">
      <p className="text-sm text-gray-600">{message}</p>
      {action}
    </div>
  );
}
