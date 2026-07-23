/** Input — UCA §3.2. Plain controlled text input; always rendered inside a
 *  FormField (the only way inputs appear in forms). */
import { forwardRef, type InputHTMLAttributes } from 'react';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = '', ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={`w-full rounded-md border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 focus:border-brand-500 aria-[invalid=true]:border-danger-600 ${className}`}
        {...rest}
      />
    );
  },
);
