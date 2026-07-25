/**
 * Scan-payload schema — F8 (Scanner). A scanned or manually-entered code is
 * OPAQUE UNTRUSTED INPUT (BR-16 / SEC-07 / EC-20): printable ASCII, ≤ 64 chars,
 * trimmed — never navigated to or executed. This is the client's FIRST GUARD:
 * a malformed payload is rejected *before* any `/products/lookup` call, so a
 * hostile decode never reaches the network. The server re-enforces the same
 * rule (422 `INVALID_BARCODE`) — this guard is a fast reject, not the authority.
 *
 * MIRROR of the server barcode rule (validation/primitives `PRINTABLE_CODE`);
 * reuses the shared `barcode` primitive so the rule lives in exactly one place.
 */
import { barcode } from '../primitives';

/** BR-16: trim → printable ASCII → ≤ 64. Reuses the `barcode` primitive verbatim. */
export const scanCodeSchema = barcode;

export interface ScanCodeParsed {
  ok: boolean;
  /** Normalized (trimmed) code — present only when `ok`. */
  code?: string;
}

/**
 * Guard a raw scan/manual payload before lookup. Returns the trimmed code when
 * valid; `{ ok: false }` for anything malformed (empty, too long, non-printable).
 * Callers render the `INVALID_BARCODE` state ("Code can't be read.") on failure
 * and MUST NOT hit the network with a rejected payload.
 */
export function parseScanCode(raw: string): ScanCodeParsed {
  const result = scanCodeSchema.safeParse(raw);
  return result.success ? { ok: true, code: result.data } : { ok: false };
}
