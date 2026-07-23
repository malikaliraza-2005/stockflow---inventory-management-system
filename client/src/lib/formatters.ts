/**
 * Wire-edge formatters (FEA §4.1): money strings and ISO-8601 UTC dates
 * become display text HERE and only here (NFR-33 — stored UTC, displayed
 * local).
 *
 * Currency fallback (SMA §5 review improvement): an unhydrated currency
 * renders amounts WITHOUT a symbol plus a ONE-TIME console warning — the
 * pre-hydration window degrades visibly-but-gracefully, never throws.
 */

let warnedMissingCurrency = false;

/** "5.99" + "USD" → "$5.99" (locale-aware); currency null → "5.99" + warning. */
export function formatMoney(amount: string, currency: string | null): string {
  const value = Number(amount);
  if (Number.isNaN(value)) return amount; // malformed wire value — show verbatim

  if (!currency) {
    if (!warnedMissingCurrency) {
      warnedMissingCurrency = true;
      console.warn('formatMoney: currency not hydrated yet — rendering symbol-less amounts');
    }
    return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  return value.toLocaleString(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  });
}

/** ISO-8601 UTC → local date + time (NFR-33). */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

/** Test seam — the one-time warning is per-session by design. */
export function resetFormatterWarnings(): void {
  warnedMissingCurrency = false;
}
