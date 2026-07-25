/**
 * useCamera — F8 low-level camera/decoder layer (FEA §6.1 · SMA §4 shared hook).
 * Wraps ZXing behind discrete, testable phases so `ScannerViewport` can render
 * each as a named UI state — the hook owns the hardware, the viewport owns the
 * pixels.
 *
 * Key contracts:
 *  - **ZXing is a LAZY dynamic import** (`import('@zxing/browser')` at start()):
 *    the decoder chunk downloads only when the camera actually starts, never on
 *    page paint (SMP §7). Manual entry works with zero camera code loaded.
 *  - **User gesture required** (NFR-35): nothing auto-starts; `start()` is
 *    called from a tap, which is also what iOS Safari needs to grant the camera.
 *  - **Secure-context / permission / no-camera** map to distinct phases (the P0
 *    spike proved the ZXing error taxonomy: NotAllowedError → permission-denied,
 *    NotFoundError/OverconstrainedError → no-camera).
 *  - **2 s duplicate-read cooldown** (EC-21): identical decodes within the
 *    window coalesce into one scan event — no card flicker.
 *  - **`paused` gates decodes without tearing down the stream**: while a result
 *    card or dialog is up, the camera keeps running but decodes are ignored, so
 *    resuming is instant (no re-permission, no re-init).
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import type { IScannerControls } from '@zxing/browser';

/** The named camera phases — every one is a `ScannerViewport` rendering. */
export type CameraPhase =
  | 'idle' // secure + capable, not yet started (tap to start)
  | 'requesting' // permission prompt / stream warm-up in flight
  | 'streaming' // live preview, decoding
  | 'permission-denied' // NotAllowedError — actionable guidance
  | 'no-camera' // no device / unreadable / bad constraints
  | 'insecure-context'; // not HTTPS — camera blocked (NFR-35)

export interface UseCameraOptions {
  /** Called with the raw decoded text (still UNVALIDATED — the caller guards it). */
  onDecode: (code: string) => void;
  /** While true, decodes are ignored (stream stays alive). */
  paused: boolean;
  /** Duplicate-read cooldown; EC-21 default 2000 ms. */
  cooldownMs?: number;
}

export interface CameraApi {
  phase: CameraPhase;
  videoRef: RefObject<HTMLVideoElement>;
  torchSupported: boolean;
  torchOn: boolean;
  toggleTorch: () => void;
  start: () => void;
  stop: () => void;
}

/** Torch lives outside the standard MediaTrack typings — narrow locally. */
type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean };

function initialPhase(): CameraPhase {
  if (typeof window !== 'undefined' && window.isSecureContext === false) return 'insecure-context';
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return 'no-camera';
  return 'idle';
}

export function useCamera({ onDecode, paused, cooldownMs = 2000 }: UseCameraOptions): CameraApi {
  const [phase, setPhase] = useState<CameraPhase>(initialPhase);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);

  // Refs so the once-built decode closure always sees the latest values.
  const pausedRef = useRef(paused);
  const onDecodeRef = useRef(onDecode);
  const cooldownRef = useRef(cooldownMs);
  const lastTextRef = useRef('');
  const lastAtRef = useRef(0);
  const startingRef = useRef(false);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  useEffect(() => {
    onDecodeRef.current = onDecode;
  }, [onDecode]);
  useEffect(() => {
    cooldownRef.current = cooldownMs;
  }, [cooldownMs]);

  const stop = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    trackRef.current = null;
    startingRef.current = false;
    setTorchSupported(false);
    setTorchOn(false);
  }, []);

  const start = useCallback(() => {
    if (window.isSecureContext === false) {
      setPhase('insecure-context');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setPhase('no-camera');
      return;
    }
    if (startingRef.current || controlsRef.current) return;
    startingRef.current = true;
    setPhase('requesting');

    void (async () => {
      let reader: import('@zxing/browser').BrowserMultiFormatReader;
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        reader = new BrowserMultiFormatReader();
      } catch {
        // Decoder chunk failed to load — manual entry remains the fallback.
        startingRef.current = false;
        setPhase('no-camera');
        return;
      }

      const video = videoRef.current;
      if (!video) {
        startingRef.current = false;
        return; // unmounted mid-start
      }

      // Constraint fallback chain (P0 spike): back camera → any camera. Pre-grant,
      // browsers hide device labels, so we ask by facingMode, not exact id.
      const attempts: MediaStreamConstraints[] = [
        { video: { facingMode: { ideal: 'environment' } } },
        { video: true },
      ];

      let controls: IScannerControls | null = null;
      let lastErr: unknown = null;
      for (const constraints of attempts) {
        try {
          controls = await reader.decodeFromConstraints(constraints, video, (result) => {
            if (phaseIsInactive(video)) return;
            setPhase('streaming');
            if (!result) return;
            if (pausedRef.current) return;
            const text = result.getText();
            const now = Date.now();
            if (text === lastTextRef.current && now - lastAtRef.current < cooldownRef.current) {
              lastAtRef.current = now;
              return; // EC-21 duplicate-read coalesce
            }
            lastTextRef.current = text;
            lastAtRef.current = now;
            if (typeof navigator.vibrate === 'function') navigator.vibrate(60);
            onDecodeRef.current(text);
          });
          break;
        } catch (err) {
          lastErr = err;
        }
      }

      startingRef.current = false;

      if (!controls) {
        setPhase(mapStartError(lastErr));
        return;
      }
      controlsRef.current = controls;

      // Torch capability probe on the live track.
      const track =
        video.srcObject instanceof MediaStream ? video.srcObject.getVideoTracks()[0] : undefined;
      trackRef.current = track ?? null;
      const caps = track?.getCapabilities?.() as TorchCapabilities | undefined;
      setTorchSupported(Boolean(caps?.torch));
    })();
  }, []);

  const toggleTorch = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const next = !torchOn;
    void track
      .applyConstraints({ advanced: [{ torch: next }] } as unknown as MediaTrackConstraints)
      .then(() => setTorchOn(next))
      .catch(() => {
        /* torch toggle can fail transiently — leave state unchanged */
      });
  }, [torchOn]);

  // Tear the camera down on unmount — the workflow dies with the page (SMA §3).
  useEffect(() => stop, [stop]);

  return { phase, videoRef, torchSupported, torchOn, toggleTorch, start, stop };
}

/** Guard: ignore late decode callbacks after the video element is gone. */
function phaseIsInactive(video: HTMLVideoElement): boolean {
  return !video.isConnected;
}

/** Map a getUserMedia/ZXing start failure onto a named side state (P0 spike taxonomy). */
function mapStartError(err: unknown): CameraPhase {
  const name =
    err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'permission-denied';
  // NotFoundError, OverconstrainedError, NotReadableError, TypeError → no usable camera.
  return 'no-camera';
}
