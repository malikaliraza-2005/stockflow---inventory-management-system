/**
 * Modal — UCA §3.1: base for every dialog. Focus trap, Esc, overlay click
 * (disabled for destructive flows), RETURNS FOCUS to the trigger (WIR §0.3),
 * full-screen < 768. `role="dialog"`, `aria-modal`, `aria-labelledby`.
 * Controlled by parent.
 */
import { useEffect, useId, useRef, type ReactNode } from 'react';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md';
  /** Destructive flows disable overlay-click dismissal (accidental-loss guard). */
  dismissOnOverlay?: boolean;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  size = 'md',
  dismissOnOverlay = true,
}: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    triggerRef.current = document.activeElement; // remember the trigger (WIR §0.3)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') trapFocus(event, dialogRef.current);
    };
    document.addEventListener('keydown', onKeyDown);

    // Move focus into the dialog
    const focusable = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    focusable?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      (triggerRef.current as HTMLElement | null)?.focus?.(); // return focus
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-0 md:p-4"
      onMouseDown={(e) => {
        if (dismissOnOverlay && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`flex h-full w-full flex-col bg-white md:h-auto md:rounded-lg ${
          size === 'sm' ? 'md:max-w-sm' : 'md:max-w-lg'
        }`}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <h2 id={titleId} className="text-lg font-medium text-gray-900">
            {title}
          </h2>
          <button
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function trapFocus(event: KeyboardEvent, container: HTMLElement | null) {
  if (!container) return;
  const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (items.length === 0) return;
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const active = document.activeElement;

  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
