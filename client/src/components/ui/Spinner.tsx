/** Spinner — UCA §3.2. Inline mutation feedback (FEA §8: skeletons for pages,
 *  spinners for mutations). */

export function Spinner({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const dimensions = size === 'sm' ? 'h-4 w-4' : 'h-6 w-6';
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`${dimensions} inline-block animate-spin rounded-full border-2 border-current border-t-transparent`}
    />
  );
}
