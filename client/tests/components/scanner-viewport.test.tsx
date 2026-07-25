/**
 * F8 — ScannerViewport machine transitions (FEA §6.1). Every camera phase is a
 * named, tested rendering. `useCamera` is mocked so the ZXing hardware layer
 * never runs — we assert the viewport maps each phase to its designed UI and
 * wires the controls (start / torch).
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/hooks/useCamera', () => ({ useCamera: vi.fn() }));

import { ScannerViewport } from '../../src/components/domain/ScannerViewport';
import { useCamera, type CameraApi, type CameraPhase } from '../../src/hooks/useCamera';

const mockedUseCamera = vi.mocked(useCamera);

function mountWith(overrides: Partial<CameraApi>) {
  const api: CameraApi = {
    phase: 'idle',
    videoRef: { current: null },
    torchSupported: false,
    torchOn: false,
    toggleTorch: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    ...overrides,
  };
  mockedUseCamera.mockReturnValue(api);
  const onDecoded = vi.fn();
  render(<ScannerViewport onDecoded={onDecoded} paused={false} />);
  return { api, onDecoded };
}

beforeEach(() => vi.clearAllMocks());

describe('ScannerViewport (FEA §6.1 state machine)', () => {
  it('idle → offers a Start camera control (user gesture, NFR-35)', async () => {
    const { api } = mountWith({ phase: 'idle' });
    const button = screen.getByRole('button', { name: /start camera/i });
    await userEvent.click(button);
    expect(api.start).toHaveBeenCalledTimes(1);
  });

  it('requesting-permission → shows the requesting guidance', () => {
    mountWith({ phase: 'requesting' });
    expect(screen.getByText(/requesting camera access/i)).toBeInTheDocument();
  });

  it('scanning → renders the live viewport (phase attribute) and no guidance overlay', () => {
    mountWith({ phase: 'streaming' });
    expect(screen.getByTestId('scanner-viewport')).toHaveAttribute('data-phase', 'streaming');
    expect(screen.queryByRole('button', { name: /start camera/i })).not.toBeInTheDocument();
  });

  it('scanning → shows the torch toggle only when supported and wires it', async () => {
    const { api } = mountWith({ phase: 'streaming', torchSupported: true });
    const torch = screen.getByRole('button', { name: /turn torch on/i });
    await userEvent.click(torch);
    expect(api.toggleTorch).toHaveBeenCalledTimes(1);
  });

  it('scanning → hides the torch toggle when unsupported', () => {
    mountWith({ phase: 'streaming', torchSupported: false });
    expect(screen.queryByRole('button', { name: /torch/i })).not.toBeInTheDocument();
  });

  it.each<[CameraPhase, RegExp]>([
    ['permission-denied', /camera access blocked/i],
    ['no-camera', /no camera available/i],
    ['insecure-context', /secure connection required/i],
  ])('side state %s → renders its named guidance', (phase, pattern) => {
    mountWith({ phase });
    expect(screen.getByText(pattern)).toBeInTheDocument();
  });

  it('permission-denied / no-camera → offer a Try again that restarts', async () => {
    const { api } = mountWith({ phase: 'permission-denied' });
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(api.start).toHaveBeenCalledTimes(1);
  });

  it('passes onDecoded and paused straight through to the camera hook', () => {
    const onDecoded = vi.fn();
    mockedUseCamera.mockReturnValue({
      phase: 'streaming',
      videoRef: { current: null },
      torchSupported: false,
      torchOn: false,
      toggleTorch: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    });
    render(<ScannerViewport onDecoded={onDecoded} paused />);
    expect(mockedUseCamera).toHaveBeenCalledWith(
      expect.objectContaining({ onDecode: onDecoded, paused: true }),
    );
  });
});
