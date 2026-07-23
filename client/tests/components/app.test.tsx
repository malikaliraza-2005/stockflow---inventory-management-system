/**
 * F1 chrome substrate. Full guard-spine routing is covered by
 * auth-flow.test.tsx with MemoryRouter (react-router's data router is
 * incompatible with jsdom's undici, so we don't render createBrowserRouter
 * here). This file pins the always-mounted feedback chrome and the toast
 * queue rendering.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { ToastRegion } from '../../src/components/ui/ToastRegion';
import { useUiStore } from '../../src/stores/uiStore';

beforeEach(() => {
  useUiStore.setState({ toasts: [], toastQueue: [], confirm: null, confirmQueue: [] });
});

describe('ToastRegion (WIR §0.3)', () => {
  it('mounts a single aria-live notifications region', () => {
    render(<ToastRegion />);
    expect(screen.getByLabelText('Notifications')).toBeInTheDocument();
  });

  it('renders an error toast with its correlation ID and keeps it until dismissed', async () => {
    render(<ToastRegion />);
    useUiStore.getState().pushToast({
      tone: 'error',
      message: 'Something failed',
      correlationId: 'c1f4',
    });

    expect(await screen.findByTestId('toast-error')).toBeInTheDocument();
    expect(screen.getByText(/reference: c1f4/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByTestId('toast-error')).not.toBeInTheDocument();
  });
});
