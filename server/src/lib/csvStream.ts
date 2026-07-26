/**
 * CSV export streaming — the ERR §7 streaming-failure policy, implemented once
 * (FR-RPT-06, F10). CSV export streams with headers already sent, so the
 * terminal error middleware cannot envelope a mid-stream failure. The policy:
 *
 *  1. FIRST-BATCH GATE — the first row is pulled from the source BEFORE any
 *     response header is written. A failure here throws to the normal error
 *     envelope (headers not yet sent) — the common case, since most failures
 *     occur before the first byte.
 *  2. On a stream error AFTER headers: log at error with the correlation ID and
 *     DESTROY the connection — the client sees an aborted download, never a
 *     plausible-but-truncated file that looks complete.
 *  3. The frontend export action detects the abort and shows a retry toast.
 *
 * The source is an AsyncIterable (a Mongoose/aggregation cursor), so the full
 * filtered dataset streams without materializing in memory (the stream-CSV
 * branch of FR-SRCH-01 that deliberately bypasses pagination).
 */
import type { Response } from 'express';

/** RFC-4180 field: quote when it contains a quote, comma, CR or LF; double `"`. */
export function csvField(value: string | number): string {
  const text = String(value);
  if (/["\n\r,]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** One CRLF-terminated CSV record. */
export function toCsvRow(values: (string | number)[]): string {
  return `${values.map(csvField).join(',')}\r\n`;
}

export interface CsvStreamOptions<T> {
  filename: string;
  header: string[];
  rows: AsyncIterable<T>;
  toColumns: (row: T) => (string | number)[];
  /** Post-headers failure sink — logs with correlation ID (never user-facing). */
  onStreamError: (error: unknown) => void;
}

export async function streamCsv<T>(res: Response, options: CsvStreamOptions<T>): Promise<void> {
  const iterator = options.rows[Symbol.asyncIterator]();

  // (1) First-batch gate — pull the first row before touching the response. A
  // rejection here bubbles to asyncHandler → the normal error envelope.
  let current = await iterator.next();

  res.status(200);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${options.filename}"`);
  res.write(toCsvRow(options.header));

  try {
    while (!current.done) {
      res.write(toCsvRow(options.toColumns(current.value)));
      current = await iterator.next();
    }
    res.end();
  } catch (error) {
    // (2) Headers already sent — cannot envelope. Destroy the socket so the
    // download aborts visibly rather than truncating into a complete-looking file.
    options.onStreamError(error);
    res.destroy();
  }
}
