/**
 * BubbleSmokeTrail — violet-and-white puffs that bloom and dissolve behind the
 * assistant bubble while it is being dragged.
 *
 * Decorative only, and built with the same constraints as the rest of the app:
 * no animation library, no canvas — just absolutely-positioned divs running one
 * CSS keyframe (`animate-smoke-puff` in index.css).
 *
 * Three things keep it from being a performance or accessibility problem:
 *
 *  - **Distance-gated emission.** A puff is emitted every EMIT_DISTANCE pixels
 *    travelled, not on every pointermove. A fast drag and a slow drag then lay
 *    down the same trail, and a jittery pointer cannot spawn hundreds of nodes.
 *  - **Self-removal on animationend.** No timers to leak, no interval sweeping a
 *    list, and a node exists for exactly as long as it is visible. MAX_PUFFS is
 *    a hard backstop in case a browser never fires the event.
 *  - **prefers-reduced-motion is honoured by NOT EMITTING**, rather than by
 *    animating invisibly. Users who ask for less motion get zero extra DOM.
 */
import { useEffect, useRef, useState } from 'react';

import { BUBBLE_SIZE, type BubblePosition } from '../../hooks/useDraggableBubble';

/** Pixels of travel between puffs. Lower = denser trail, more nodes. */
const EMIT_DISTANCE = 14;
const MAX_PUFFS = 24;

interface SmokePuff {
  id: number;
  /** Viewport centre of the puff. */
  x: number;
  y: number;
  size: number;
  driftX: number;
  driftY: number;
  /** Alternating violet/white is what reads as "smoke" rather than "bubbles". */
  white: boolean;
}

function prefersReducedMotion(): boolean {
  // jsdom has no matchMedia; treat its absence as "motion is fine".
  if (typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface BubbleSmokeTrailProps {
  /** True while a drag is in progress. */
  active: boolean;
  /** The bubble's top-left, or null before it has ever been dragged. */
  position: BubblePosition | null;
}

export function BubbleSmokeTrail({ active, position }: BubbleSmokeTrailProps) {
  const [puffs, setPuffs] = useState<SmokePuff[]>([]);
  const lastEmit = useRef<BubblePosition | null>(null);
  const nextId = useRef(0);

  useEffect(() => {
    if (!active || position === null || prefersReducedMotion()) {
      lastEmit.current = null;
      return;
    }

    const last = lastEmit.current;
    if (last !== null && Math.hypot(position.x - last.x, position.y - last.y) < EMIT_DISTANCE) {
      return;
    }
    lastEmit.current = { x: position.x, y: position.y };

    const id = nextId.current;
    nextId.current += 1;
    const puff: SmokePuff = {
      id,
      // Emitted from the bubble's CENTRE, jittered so the trail has width.
      x: position.x + BUBBLE_SIZE / 2 + (Math.random() - 0.5) * 18,
      y: position.y + BUBBLE_SIZE / 2 + (Math.random() - 0.5) * 18,
      size: 26 + Math.random() * 26,
      driftX: (Math.random() - 0.5) * 34,
      // Biased upward — smoke rises, and a trail that only spreads sideways
      // reads as a smear.
      driftY: -8 - Math.random() * 26,
      white: id % 2 === 0,
    };

    setPuffs((current) => [...current.slice(-(MAX_PUFFS - 1)), puff]);
  }, [active, position]);

  if (puffs.length === 0) return null;

  return (
    // Below the bubble (z-50) and above the page. Never intercepts a pointer —
    // a decorative layer must not swallow the drag it is decorating.
    <div
      aria-hidden="true"
      data-testid="chat-bubble-smoke"
      className="pointer-events-none fixed inset-0 z-40"
    >
      {puffs.map((puff) => (
        <span
          key={puff.id}
          onAnimationEnd={() => setPuffs((current) => current.filter((p) => p.id !== puff.id))}
          style={{
            left: puff.x,
            top: puff.y,
            width: puff.size,
            height: puff.size,
            ['--drift-x' as string]: `${String(puff.driftX)}px`,
            ['--drift-y' as string]: `${String(puff.driftY)}px`,
          }}
          className={`animate-smoke-puff absolute rounded-full blur-md ${
            puff.white
              ? 'bg-linear-to-br from-white to-brand-100'
              : 'bg-linear-to-br from-brand-300 to-brand-500'
          }`}
        />
      ))}
    </div>
  );
}
