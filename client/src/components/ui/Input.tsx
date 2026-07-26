/** Input — UCA §3.2. Plain controlled text input; always rendered inside a
 *  FormField (the only way inputs appear in forms). */
import { forwardRef, type InputHTMLAttributes } from 'react';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = '', ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={`w-full rounded-lg border border-neutral-300 bg-white px-3.5 py-2.5 text-sm text-neutral-900 placeholder-neutral-400 shadow-xs transition-colors focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/20 aria-[invalid=true]:border-danger-600 aria-[invalid=true]:focus:ring-danger-600/20 ${className}`}
        {...rest}
      />
    );
  },
);
