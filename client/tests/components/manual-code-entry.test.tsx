/**
 * F8 — ManualCodeEntry: the universal fallback. A valid code reaches `onSubmit`
 * trimmed; a hostile/malformed payload renders the inline INVALID_BARCODE
 * message and NEVER calls `onSubmit` (BR-16 — the network is never hit).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ManualCodeEntry } from '../../src/components/domain/ManualCodeEntry';

describe('ManualCodeEntry (FR-SCAN-01 / BR-16)', () => {
  it('submits a valid code trimmed and clears the field', async () => {
    const onSubmit = vi.fn();
    render(<ManualCodeEntry onSubmit={onSubmit} />);

    const input = screen.getByLabelText(/enter a code/i);
    await userEvent.type(input, '  ELEC-1  ');
    await userEvent.click(screen.getByRole('button', { name: /look up/i }));

    expect(onSubmit).toHaveBeenCalledWith('ELEC-1');
    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('submits on Enter', async () => {
    const onSubmit = vi.fn();
    render(<ManualCodeEntry onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText(/enter a code/i), 'SKU-9{Enter}');
    expect(onSubmit).toHaveBeenCalledWith('SKU-9');
  });

  it('rejects an empty submit inline without calling onSubmit', async () => {
    const onSubmit = vi.fn();
    render(<ManualCodeEntry onSubmit={onSubmit} />);

    await userEvent.click(screen.getByRole('button', { name: /look up/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/code can't be read/i)).toBeInTheDocument();
  });

  it('rejects a non-printable payload inline (non-ASCII) — never hits onSubmit', async () => {
    const onSubmit = vi.fn();
    render(<ManualCodeEntry onSubmit={onSubmit} />);

    // `<input>` strips control chars, so use a non-ASCII char (é > 0x7E) that
    // survives the field but fails the printable-ASCII guard (BR-16).
    const input = screen.getByLabelText(/enter a code/i);
    fireEvent.change(input, { target: { value: 'café' } });
    await userEvent.click(screen.getByRole('button', { name: /look up/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/code can't be read/i)).toBeInTheDocument();
  });

  it('disables the lookup button while a lookup is in flight', () => {
    render(<ManualCodeEntry onSubmit={vi.fn()} disabled />);
    expect(screen.getByRole('button', { name: /look up/i })).toBeDisabled();
  });
});
