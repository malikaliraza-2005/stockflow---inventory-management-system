/** Skeleton — UCA §3.2 (text/card/table-row variants; chart arrives with F9).
 *  Page loads render skeletons, never spinners (FEA §8 — no layout shift). */

const variantClasses = {
  text: 'h-4 w-full rounded',
  card: 'h-32 w-full rounded-lg',
  'table-row': 'h-10 w-full rounded',
} as const;

export function Skeleton({
  variant = 'text',
  className = '',
}: {
  variant?: keyof typeof variantClasses;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse bg-gray-200 ${variantClasses[variant]} ${className}`}
    />
  );
}
