/**
 * F8 T-a — scan-payload guard (BR-16 / EC-20). The client's first defense: a
 * malformed decode is rejected BEFORE any lookup call. Mirrors the server
 * `PRINTABLE_CODE` rule (printable ASCII, ≤ 64, trimmed). Hostile-but-printable
 * strings (e.g. `<script>`) are VALID payloads by design — they are opaque and
 * rendered escaped; hardening is at the render boundary, not the length gate.
 */
import { describe, expect, it } from 'vitest';

import { parseScanCode, scanCodeSchema } from '../../src/lib/validation/schemas/scanner';

describe('scanCodeSchema (BR-16 payload guard)', () => {
  it('accepts a plain barcode and a SKU', () => {
    expect(parseScanCode('8412345678905')).toEqual({ ok: true, code: '8412345678905' });
    expect(parseScanCode('ELEC-00001')).toEqual({ ok: true, code: 'ELEC-00001' });
  });

  it('trims surrounding whitespace', () => {
    expect(parseScanCode('  ABC-123  ')).toEqual({ ok: true, code: 'ABC-123' });
  });

  it('accepts exactly 64 characters and rejects 65 (the ≤ 64 boundary)', () => {
    const at = 'A'.repeat(64);
    const over = 'A'.repeat(65);
    expect(parseScanCode(at).ok).toBe(true);
    expect(parseScanCode(over).ok).toBe(false);
  });

  it('treats printable-but-hostile strings as valid opaque payloads', () => {
    // ≤ 64 printable ASCII — passed through opaque; XSS-safe at render, not here.
    expect(parseScanCode('<script>alert(1)</script>').ok).toBe(true);
    expect(parseScanCode("'; DROP TABLE products;--").ok).toBe(true);
  });

  it('rejects empty and whitespace-only input', () => {
    expect(parseScanCode('').ok).toBe(false);
    expect(parseScanCode('    ').ok).toBe(false);
  });

  it('rejects non-printable control characters (newline, tab, null)', () => {
    expect(parseScanCode('bad\nvalue').ok).toBe(false);
    expect(parseScanCode('bad\tvalue').ok).toBe(false);
    expect(parseScanCode('bad\x00value').ok).toBe(false);
  });

  it('rejects non-ASCII characters (beyond 0x7E)', () => {
    expect(parseScanCode('café').ok).toBe(false);
    expect(parseScanCode('日本語').ok).toBe(false);
  });

  it('scanCodeSchema.safeParse mirrors parseScanCode', () => {
    expect(scanCodeSchema.safeParse('OK-1').success).toBe(true);
    expect(scanCodeSchema.safeParse('x'.repeat(65)).success).toBe(false);
  });
});
