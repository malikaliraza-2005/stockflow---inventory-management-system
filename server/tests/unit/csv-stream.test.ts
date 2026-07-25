/**
 * F10 T-c — the ERR §7 streaming-failure policy (streamCsv). The export writes
 * rows only after a successful first batch; a pre-header failure propagates
 * normally (headers never sent), and a post-header failure DESTROYS the socket
 * rather than emitting a truncated-but-complete-looking file.
 */
import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { csvField, streamCsv, toCsvRow } from '../../src/lib/csvStream.js';

function fakeRes() {
  const state = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    writes: [] as string[],
    ended: false,
    destroyed: false,
  };
  const res = {
    status(code: number) {
      state.statusCode = code;
      return res;
    },
    setHeader(key: string, value: string) {
      state.headers[key] = value;
    },
    write(chunk: string) {
      state.writes.push(chunk);
      return true;
    },
    end() {
      state.ended = true;
    },
    destroy() {
      state.destroyed = true;
    },
  };
  return { res: res as unknown as Response, state };
}

async function* twoRows() {
  yield { a: 1 };
  yield { a: 2 };
}
// eslint-disable-next-line require-yield -- models a source that fails on the first read
async function* failFirst(): AsyncGenerator<{ a: number }> {
  throw new Error('db down before first row');
}
async function* failSecond() {
  yield { a: 1 };
  throw new Error('stream broke mid-flight');
}

const opts = (rows: AsyncIterable<{ a: number }>, onStreamError = vi.fn()) => ({
  filename: 'x.csv',
  header: ['A'],
  rows,
  toColumns: (row: { a: number }) => [row.a],
  onStreamError,
});

describe('csv escaping', () => {
  it('quotes fields with commas, quotes, or newlines and doubles quotes', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(toCsvRow(['a', 1, 'x,y'])).toBe('a,1,"x,y"\r\n');
  });
});

describe('streamCsv (ERR §7)', () => {
  it('happy path: header then every row, then end — no destroy', async () => {
    const { res, state } = fakeRes();
    await streamCsv(res, opts(twoRows()));
    expect(state.statusCode).toBe(200);
    expect(state.headers['Content-Type']).toBe('text/csv; charset=utf-8');
    expect(state.headers['Content-Disposition']).toContain('attachment');
    expect(state.writes).toEqual(['A\r\n', '1\r\n', '2\r\n']);
    expect(state.ended).toBe(true);
    expect(state.destroyed).toBe(false);
  });

  it('first-batch failure throws BEFORE any header/byte (normal envelope path)', async () => {
    const { res, state } = fakeRes();
    await expect(streamCsv(res, opts(failFirst()))).rejects.toThrow('db down before first row');
    expect(state.statusCode).toBe(0);
    expect(state.writes).toHaveLength(0);
    expect(state.headers['Content-Type']).toBeUndefined();
    expect(state.destroyed).toBe(false);
  });

  it('mid-stream failure destroys the connection after headers (no truncated file)', async () => {
    const { res, state } = fakeRes();
    const onStreamError = vi.fn();
    await streamCsv(res, opts(failSecond(), onStreamError));
    expect(state.writes).toEqual(['A\r\n', '1\r\n']); // header + first row only
    expect(state.ended).toBe(false); // never a clean end
    expect(state.destroyed).toBe(true);
    expect(onStreamError).toHaveBeenCalledOnce();
  });
});
