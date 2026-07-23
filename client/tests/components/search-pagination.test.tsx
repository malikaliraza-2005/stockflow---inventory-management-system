/**
 * F2 — SearchInput debounce (300 ms) + Pagination "Showing a–b of n" and
 * boundary disabling.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Pagination } from '../../src/components/ui/Pagination';
import { SearchInput } from '../../src/components/ui/SearchInput';

afterEach(() => {
  vi.useRealTimers(); // never leak fake timers into a sibling test
});

describe('SearchInput (UCA §3.1)', () => {
  it('debounces the committed value (one call after the pause)', async () => {
    const onDebouncedChange = vi.fn();
    render(<SearchInput value="" onDebouncedChange={onDebouncedChange} />);

    await userEvent.type(screen.getByRole('searchbox'), 'abc');
    // real-timer debounce: the commit fires once after the window settles
    await waitFor(() => expect(onDebouncedChange).toHaveBeenCalledExactlyOnceWith('abc'), {
      timeout: 1000,
    });
  });
});

describe('Pagination (UCA §3.2)', () => {
  it('shows the range and disables Previous on page 1', () => {
    render(<Pagination page={1} totalPages={7} totalItems={137} limit={20} onChange={vi.fn()} />);
    expect(screen.getByText('Showing 1–20 of 137')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next/i })).toBeEnabled();
  });

  it('disables Next on the last page and emits page changes', async () => {
    const onChange = vi.fn();
    render(<Pagination page={7} totalPages={7} totalItems={137} limit={20} onChange={onChange} />);
    expect(screen.getByText('Showing 121–137 of 137')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: /previous/i }));
    expect(onChange).toHaveBeenCalledWith(6);
  });

  it('renders nothing when there are no items', () => {
    const { container } = render(
      <Pagination page={1} totalPages={0} totalItems={0} limit={20} onChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
