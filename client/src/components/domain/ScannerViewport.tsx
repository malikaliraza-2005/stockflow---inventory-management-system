/**
 * ScannerViewport — UCA §5.1 / FEA §6.1. The camera half of the scanner state
 * machine: EVERY phase is a named, tested rendering — no improvised conditionals.
 *
 *   idle → requesting-permission → scanning        (happy path)
 *   side states: permission-denied · no-camera · insecure-context
 *
 * The lookup tail (looking-up → found | not-found | archived) belongs to the
 * page, not here — this component only decodes and emits `onDecoded(code)`.
 * `paused` freezes decode handling (a result/dialog is up) without tearing the
 * stream down. The `<video>` is always mounted so the camera ref exists before
 * `start()` runs; non-streaming phases render an overlay on top of it.
 *
 * A11y: guidance states are text (never color-only); the phase is announced via
 * a polite live region (WCAG AA, NFR-30); the manual-entry sibling — rendered by
 * the page in ALL states — is the guaranteed fallback (FR-SCAN-01).
 *
 * Loaded as a lazy chunk (SMP §7): the ZXing decoder never touches page paint.
 */
import { useCamera, type CameraPhase } from '../../hooks/useCamera';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';

export interface ScannerViewportProps {
  onDecoded: (code: string) => void;
  paused: boolean;
}

/** Human guidance for the non-streaming phases (the side states of FEA §6.1). */
const GUIDANCE: Record<Exclude<CameraPhase, 'streaming'>, { title: string; body: string }> = {
  idle: {
    title: 'Scan a barcode',
    body: 'Start the camera to scan, or type a code below.',
  },
  requesting: {
    title: 'Requesting camera access…',
    body: 'Allow camera access when your browser asks.',
  },
  'permission-denied': {
    title: 'Camera access blocked',
    body: 'Enable camera access in your browser settings, or use manual entry below.',
  },
  'no-camera': {
    title: 'No camera available',
    body: 'This device has no usable camera. Use manual entry below.',
  },
  'insecure-context': {
    title: 'Secure connection required',
    body: 'Camera scanning needs an HTTPS connection. Use manual entry below.',
  },
};

export function ScannerViewport({ onDecoded, paused }: ScannerViewportProps) {
  const { phase, videoRef, torchSupported, torchOn, toggleTorch, start } = useCamera({
    onDecode: onDecoded,
    paused,
  });

  const streaming = phase === 'streaming';
  const guidance = streaming ? null : GUIDANCE[phase];
  const retryable = phase === 'permission-denied' || phase === 'no-camera';

  return (
    <div
      className="relative flex h-[55dvh] max-h-130 w-full items-center justify-center overflow-hidden rounded-lg bg-gray-900 md:h-80"
      data-testid="scanner-viewport"
      data-phase={phase}
    >
      {/* Always mounted so the camera ref exists before start() runs. */}
      <video
        ref={videoRef}
        className={`h-full w-full object-cover ${streaming ? '' : 'invisible'}`}
        playsInline
        muted
        aria-hidden="true"
      />

      {streaming && (
        <>
          {/* Guide frame — decorative alignment target. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
          >
            <div className="h-40 w-64 rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
          {torchSupported && (
            <div className="absolute bottom-3 right-3">
              <Button
                variant="secondary"
                onClick={toggleTorch}
                aria-pressed={torchOn}
                aria-label={torchOn ? 'Turn torch off' : 'Turn torch on'}
              >
                {torchOn ? 'Torch off' : 'Torch on'}
              </Button>
            </div>
          )}
        </>
      )}

      {/* One polite live region announces the machine phase (NFR-30): the
          guidance overlay when idle/side-state, an sr-only line while scanning. */}
      {guidance ? (
        <div
          role="status"
          aria-live="polite"
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center"
        >
          {phase === 'requesting' && <Spinner size="md" />}
          <p className="text-base font-medium text-white">{guidance.title}</p>
          <p className="max-w-xs text-sm text-gray-300">{guidance.body}</p>
          {phase === 'idle' && (
            <Button variant="primary" onClick={start}>
              Start camera
            </Button>
          )}
          {retryable && (
            <Button variant="secondary" onClick={start}>
              Try again
            </Button>
          )}
        </div>
      ) : (
        <p className="sr-only" role="status" aria-live="polite">
          Scanning. Point the camera at a barcode.
        </p>
      )}
    </div>
  );
}

export default ScannerViewport;
