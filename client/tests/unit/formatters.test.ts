/**
 * F1 — lib/formatters: the SMA §5 currency fallback (symbol-less + ONE
 * console warning) and wire-edge conversions (NFR-33).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatDateTime, formatMoney, resetFormatterWarnings } from '../../src/lib/formatters';

afterEach(() => {
  resetFormatterWarnings();
  vi.restoreAllMocks();
});

describe('formatMoney', () => {
  it('renders with the hydrated currency', () => {
    const formatted = formatMoney('5.99', 'USD');
    expect(formatted).toContain('5.99');
    expect(formatted).toMatch(/\$|USD/);
  });

  it('degrades to symbol-less with ONE warning when currency is null (SMA §5)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(formatMoney('5.99', null)).toBe('5.99');
    expect(formatMoney('1200', null)).not.toMatch(/\$|USD/); // still symbol-less
    expect(warn).toHaveBeenCalledTimes(1); // one-time, not per call
  });

  it('shows malformed wire values verbatim instead of NaN', () => {
    expect(formatMoney('not-money', 'USD')).toBe('not-money');
  });
});

describe('formatDateTime', () => {
  it('renders ISO-8601 UTC as local display text', () => {
    const formatted = formatDateTime('2026-07-23T14:03:11.000Z');
    expect(formatted).toMatch(/2026/);
  });

  it('shows malformed dates verbatim', () => {
    expect(formatDateTime('garbage')).toBe('garbage');
  });
});
