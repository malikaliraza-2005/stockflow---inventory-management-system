/**
 * F11 — Settings page: loads the current settings, saves an edited threshold
 * (payload shape), and rejects an out-of-range value inline.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000');

vi.mock('../../src/api/settings', () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

import { getSettings, updateSettings } from '../../src/api/settings';
import { useAuthStore } from '../../src/stores/authStore';
import SettingsPage from '../../src/pages/Settings';

const mockedGet = vi.mocked(getSettings);
const mockedUpdate = vi.mocked(updateSettings);

const SETTINGS = {
  currency: 'USD',
  defaultLowStockThreshold: 10,
  movementWarningThreshold: 1000,
  updatedAt: '2026-07-01T00:00:00.000Z',
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/settings']}>
      <SettingsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGet.mockResolvedValue(SETTINGS);
  useAuthStore.getState().setSession('token', {
    id: 'admin',
    name: 'Ada Admin',
    email: 'ada@example.com',
    role: 'ADMIN',
    mustChangePassword: false,
  });
});

describe('Settings page (F11)', () => {
  it('loads current settings and saves an edited threshold', async () => {
    mockedUpdate.mockResolvedValue({ ...SETTINGS, defaultLowStockThreshold: 25 });
    renderPage();

    const lowStock = await screen.findByLabelText(/default low-stock threshold/i);
    expect(lowStock).toHaveValue('10');

    await userEvent.clear(lowStock);
    await userEvent.type(lowStock, '25');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(mockedUpdate).toHaveBeenCalledWith({
      currency: 'USD',
      defaultLowStockThreshold: 25,
      movementWarningThreshold: 1000,
    });
  });

  it('rejects an out-of-range warning threshold inline', async () => {
    renderPage();
    const warning = await screen.findByLabelText(/movement warning threshold/i);
    await userEvent.clear(warning);
    await userEvent.type(warning, '0'); // below the minimum of 1
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText(/between 1 and 100,000/i)).toBeInTheDocument();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });
});
