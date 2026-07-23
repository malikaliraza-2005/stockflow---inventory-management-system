/**
 * uiStore — SMA §4, 1:1. Global presentation coordination; the only store
 * components write freely.
 *
 * Edge policies (SMA review Issue 1):
 *  - Toast overflow QUEUES: visible stack ≤ 3; queued toasts surface as slots
 *    free; error toasts keep persist-until-dismissed while queued.
 *  - Confirm collisions queue FIFO: a second requestConfirm awaits the
 *    first's resolution — never dropped, never nested.
 *
 * `sidebarCollapsed` is the ONLY persisted byte in the app (cosmetic).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ToastTone = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  tone: ToastTone;
  message: string;
  correlationId?: string | undefined;
}

export interface ConfirmRequest {
  title: string;
  body: string;
  tone?: 'default' | 'danger';
  confirmLabel?: string;
}

interface PendingConfirm {
  request: ConfirmRequest;
  resolve: (confirmed: boolean) => void;
}

const VISIBLE_TOAST_CAP = 3; // WIR §0.3 / SMA §4

export interface UiState {
  toasts: Toast[];
  toastQueue: Toast[];
  confirm: PendingConfirm | null;
  confirmQueue: PendingConfirm[];
  sidebarCollapsed: boolean;
  drawerOpen: boolean;
}

export interface UiActions {
  pushToast(toast: Omit<Toast, 'id'>): void;
  dismissToast(id: string): void;
  requestConfirm(request: ConfirmRequest): Promise<boolean>;
  resolveConfirm(confirmed: boolean): void;
  toggleSidebar(): void;
  setDrawerOpen(open: boolean): void;
  /** endSession slice (SMA §7): toasts cleared, confirms cancelled, drawer
   *  closed; sidebarCollapsed SURVIVES (preference, not session data). */
  resetForSessionEnd(): void;
}

let toastSeq = 0;

export const useUiStore = create<UiState & UiActions>()(
  persist(
    (set, get) => ({
      toasts: [],
      toastQueue: [],
      confirm: null,
      confirmQueue: [],
      sidebarCollapsed: false,
      drawerOpen: false,

      pushToast: (toast) => {
        const entry: Toast = { ...toast, id: `t${(toastSeq += 1)}` };
        set((state) =>
          state.toasts.length < VISIBLE_TOAST_CAP
            ? { toasts: [...state.toasts, entry] }
            : { toastQueue: [...state.toastQueue, entry] },
        );
      },

      dismissToast: (id) => {
        set((state) => {
          const toasts = state.toasts.filter((t) => t.id !== id);
          const [next, ...rest] = state.toastQueue;
          // A freed slot surfaces the oldest queued toast
          return next ? { toasts: [...toasts, next], toastQueue: rest } : { toasts };
        });
      },

      requestConfirm: (request) =>
        new Promise<boolean>((resolve) => {
          const pending: PendingConfirm = { request, resolve };
          set((state) =>
            state.confirm
              ? { confirmQueue: [...state.confirmQueue, pending] } // FIFO — never nested
              : { confirm: pending },
          );
        }),

      resolveConfirm: (confirmed) => {
        const { confirm } = get();
        confirm?.resolve(confirmed);
        set((state) => {
          const [next, ...rest] = state.confirmQueue;
          return { confirm: next ?? null, confirmQueue: rest };
        });
      },

      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setDrawerOpen: (drawerOpen) => set({ drawerOpen }),

      resetForSessionEnd: () => {
        const { confirm, confirmQueue } = get();
        confirm?.resolve(false); // pending confirms resolve-as-cancel
        confirmQueue.forEach((pending) => pending.resolve(false));
        set({ toasts: [], toastQueue: [], confirm: null, confirmQueue: [], drawerOpen: false });
      },
    }),
    {
      name: 'ims-ui',
      partialize: (state) => ({ sidebarCollapsed: state.sidebarCollapsed }),
    },
  ),
);

export const selectToasts = (s: UiState) => s.toasts;
export const selectConfirm = (s: UiState) => s.confirm;
export const selectSidebarCollapsed = (s: UiState) => s.sidebarCollapsed;
export const selectDrawerOpen = (s: UiState) => s.drawerOpen;
