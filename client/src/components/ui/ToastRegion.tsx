/**
 * ToastRegion — UCA §3.1: single aria-live region; top-right desktop / top
 * mobile; visible stack ≤ 3 (uiStore enforces + queues overflow); success
 * auto-dismisses, errors persist until dismissed and show the correlation ID
 * (ERR §5.2 "reference: …").
 */
import { useEffect } from 'react';

import { selectToasts, useUiStore, type Toast } from '../../stores/uiStore';

const AUTO_DISMISS_MS = 5000;

const toneClasses = {
  success: 'border-success-600/30 bg-success-100 text-success-600',
  error: 'border-danger-600/30 bg-danger-100 text-danger-600',
  info: 'border-brand-500/30 bg-brand-50 text-brand-700',
} as const;

function ToastCard({ toast }: { toast: Toast }) {
  const dismissToast = useUiStore((s) => s.dismissToast);

  useEffect(() => {
    if (toast.tone === 'error') return undefined; // errors persist (WIR §0.3)
    const timer = setTimeout(() => dismissToast(toast.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast.id, toast.tone, dismissToast]);

  return (
    <div
      className={`pointer-events-auto flex items-start justify-between gap-3 rounded-md border px-4 py-3 text-sm shadow-md ${toneClasses[toast.tone]}`}
      data-testid={`toast-${toast.tone}`}
    >
      <div>
        <p>{toast.message}</p>
        {toast.correlationId && (
          <p className="mt-1 text-xs opacity-75">reference: {toast.correlationId}</p>
        )}
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => dismissToast(toast.id)}
        className="text-current opacity-60 hover:opacity-100"
      >
        ×
      </button>
    </div>
  );
}

export function ToastRegion() {
  const toasts = useUiStore(selectToasts);
  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="pointer-events-none fixed top-4 left-1/2 z-50 flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4 md:left-auto md:right-4 md:translate-x-0 md:px-0"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
