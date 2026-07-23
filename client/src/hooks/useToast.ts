/**
 * useToast — the uiStore facade components import (SMA §11: facades are the
 * public API). Success auto-dismisses (ToastRegion timer); errors persist
 * until dismissed and carry the correlation ID (ERR §5.2).
 */
import { useCallback } from 'react';

import { useUiStore } from '../stores/uiStore';

export interface ToastApi {
  success(message: string): void;
  error(message: string, options?: { correlationId?: string | undefined }): void;
  info(message: string): void;
}

export function useToast(): ToastApi {
  const pushToast = useUiStore((s) => s.pushToast);
  return {
    success: useCallback((message: string) => pushToast({ tone: 'success', message }), [pushToast]),
    error: useCallback(
      (message: string, options?: { correlationId?: string | undefined }) =>
        pushToast({ tone: 'error', message, correlationId: options?.correlationId }),
      [pushToast],
    ),
    info: useCallback((message: string) => pushToast({ tone: 'info', message }), [pushToast]),
  };
}
