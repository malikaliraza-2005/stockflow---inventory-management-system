/**
 * F1 — the three stores as pure transitions (SMA §10: vanilla actions, no
 * React) + the endSession full-sequence assertion (SMA §7).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000');

import { endSession, registerSessionEndNavigator } from '../../src/api/session';
import { useAuthStore } from '../../src/stores/authStore';
import { useSettingsStore } from '../../src/stores/settingsStore';
import { useUiStore } from '../../src/stores/uiStore';

const USER = {
  id: 'u1',
  name: 'Sara',
  email: 'sara@example.com',
  role: 'STAFF' as const,
  mustChangePassword: false,
};

beforeEach(() => {
  useAuthStore.setState({ accessToken: null, user: null, status: 'initializing' });
  useSettingsStore.getState().clear();
  useUiStore.setState({
    toasts: [],
    toastQueue: [],
    confirm: null,
    confirmQueue: [],
    drawerOpen: false,
  });
});

describe('authStore (SMA §3)', () => {
  it('setSession flips status and holds the token in memory only', () => {
    useAuthStore.getState().setSession('token-1', USER);
    const state = useAuthStore.getState();
    expect(state.status).toBe('authenticated');
    expect(state.accessToken).toBe('token-1');
    expect(localStorage.getItem('ims-ui')).not.toContain('token-1'); // A-7: never persisted
  });

  it('updateUser patches without touching the token (forced-change cleared)', () => {
    useAuthStore.getState().setSession('token-1', { ...USER, mustChangePassword: true });
    useAuthStore.getState().updateUser({ mustChangePassword: false });
    expect(useAuthStore.getState().user?.mustChangePassword).toBe(false);
    expect(useAuthStore.getState().accessToken).toBe('token-1');
  });

  it('clearSession → unauthenticated with nothing left behind', () => {
    useAuthStore.getState().setSession('token-1', USER);
    useAuthStore.getState().clearSession('expired');
    expect(useAuthStore.getState()).toMatchObject({
      accessToken: null,
      user: null,
      status: 'unauthenticated',
    });
  });
});

describe('uiStore (SMA §4 — review Issue 1 edge policies)', () => {
  it('caps visible toasts at 3 and queues overflow; dismissal surfaces the queue', () => {
    const { pushToast } = useUiStore.getState();
    for (let i = 1; i <= 5; i += 1) pushToast({ tone: 'info', message: `m${i}` });

    let state = useUiStore.getState();
    expect(state.toasts.map((t) => t.message)).toEqual(['m1', 'm2', 'm3']);
    expect(state.toastQueue.map((t) => t.message)).toEqual(['m4', 'm5']);

    useUiStore.getState().dismissToast(state.toasts[0]!.id);
    state = useUiStore.getState();
    expect(state.toasts.map((t) => t.message)).toEqual(['m2', 'm3', 'm4']); // oldest queued surfaced
    expect(state.toastQueue.map((t) => t.message)).toEqual(['m5']);
  });

  it('queues confirm collisions FIFO — never dropped, never nested', async () => {
    const first = useUiStore.getState().requestConfirm({ title: 'A', body: 'first?' });
    const second = useUiStore.getState().requestConfirm({ title: 'B', body: 'second?' });

    expect(useUiStore.getState().confirm?.request.title).toBe('A');
    expect(useUiStore.getState().confirmQueue).toHaveLength(1);

    useUiStore.getState().resolveConfirm(true);
    await expect(first).resolves.toBe(true);
    expect(useUiStore.getState().confirm?.request.title).toBe('B'); // FIFO successor

    useUiStore.getState().resolveConfirm(false);
    await expect(second).resolves.toBe(false);
    expect(useUiStore.getState().confirm).toBeNull();
  });
});

describe('settingsStore (SMA §5 — FCM-01 hydration)', () => {
  it('hydrates from the session payload and clears with it', () => {
    useSettingsStore.getState().setSettings({ currency: 'EUR', movementWarningThreshold: 500 });
    expect(useSettingsStore.getState()).toMatchObject({
      currency: 'EUR',
      movementWarningThreshold: 500,
      loaded: true,
    });
    useSettingsStore.getState().clear();
    expect(useSettingsStore.getState()).toMatchObject({ currency: null, loaded: false });
  });
});

describe('endSession (SMA §7 — the ONE teardown owner)', () => {
  it('clears auth + settings, resets ui (confirms cancelled), then navigates', async () => {
    const navigator = vi.fn();
    registerSessionEndNavigator(navigator);

    useAuthStore.getState().setSession('token-1', USER);
    useSettingsStore.getState().setSettings({ currency: 'EUR' });
    useUiStore.getState().pushToast({ tone: 'error', message: 'stale' });
    const pendingConfirm = useUiStore.getState().requestConfirm({ title: 'X', body: '?' });
    useUiStore.getState().setDrawerOpen(true);
    useUiStore.setState({ sidebarCollapsed: true });

    endSession('expired');

    expect(useAuthStore.getState().status).toBe('unauthenticated');
    expect(useSettingsStore.getState().loaded).toBe(false);
    expect(useUiStore.getState().toasts).toHaveLength(0);
    await expect(pendingConfirm).resolves.toBe(false); // resolved-as-cancel
    expect(useUiStore.getState().drawerOpen).toBe(false);
    expect(useUiStore.getState().sidebarCollapsed).toBe(true); // preference SURVIVES
    expect(navigator).toHaveBeenCalledWith('expired');
  });
});
