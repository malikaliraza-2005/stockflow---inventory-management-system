/**
 * useDraggableBubble — pointer-drag for the floating assistant bubble.
 *
 * Four things make a draggable FAB tolerable rather than annoying, and all four
 * are here:
 *
 *  1. **A movement threshold.** Without it every click registers as a
 *     micro-drag, the bubble twitches, and the panel opens anyway. Below
 *     DRAG_THRESHOLD the gesture is a click and nothing moves.
 *  2. **Click suppression after a real drag.** Releasing the pointer fires
 *     `click`, so dropping the bubble would also open the panel. The widget
 *     asks `consumeClick()` first.
 *  3. **Clamping, re-applied on resize.** A bubble dragged to the right edge of
 *     a wide window would otherwise be stranded off-screen the moment the
 *     window narrows — unreachable, with no way to get it back.
 *  4. **Persistence.** A position that resets every navigation is worse than
 *     one you cannot move at all. Written once on drop, never per pointermove.
 *
 * Pointer Events (not mouse events) so touch and pen work with the same code,
 * and pointer capture keeps the drag alive when the cursor outruns the button.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

/** h-14 w-14 on the button — kept in sync by eye; only used for clamping. */
export const BUBBLE_SIZE = 56;
const EDGE_MARGIN = 16;
const DRAG_THRESHOLD = 4;
const STORAGE_KEY = 'ims.assistant.bubblePosition';

/** Viewport coordinates of the bubble's top-left corner. */
export interface BubblePosition {
  x: number;
  y: number;
}

function clampToViewport(position: BubblePosition): BubblePosition {
  const maxX = Math.max(EDGE_MARGIN, window.innerWidth - BUBBLE_SIZE - EDGE_MARGIN);
  const maxY = Math.max(EDGE_MARGIN, window.innerHeight - BUBBLE_SIZE - EDGE_MARGIN);
  return {
    x: Math.min(Math.max(position.x, EDGE_MARGIN), maxX),
    y: Math.min(Math.max(position.y, EDGE_MARGIN), maxY),
  };
}

/** Storage is untrusted input — a hand-edited or half-written value must not
 *  throw on mount and take the whole shell down with it. */
function readStored(): BubblePosition | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { x, y } = parsed as Record<string, unknown>;
    if (typeof x !== 'number' || typeof y !== 'number') return null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  } catch {
    return null;
  }
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  moved: boolean;
}

export interface DraggableBubble {
  /** `null` = never dragged; the button keeps its CSS default corner. */
  position: BubblePosition | null;
  dragging: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  /** True when the click that follows a drop must be ignored. Single-use. */
  consumeClick: () => boolean;
}

export function useDraggableBubble(): DraggableBubble {
  const [position, setPosition] = useState<BubblePosition | null>(() => {
    const stored = readStored();
    return stored === null ? null : clampToViewport(stored);
  });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<DragState | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    const onResize = () => {
      setPosition((current) => (current === null ? null : clampToViewport(current)));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Persist on drop, not on every move: a localStorage write per pointermove is
  // a synchronous disk touch on the drag path.
  useEffect(() => {
    if (dragging || position === null) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(position));
    } catch {
      // Private mode / quota — a bubble that forgets its spot is not worth failing over.
    }
  }, [position, dragging]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.left,
      originY: rect.top,
      moved: false,
    };
    // Optional-called: jsdom has no pointer capture, and neither does every browser
    // for every pointer type.
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (state === null || state.pointerId !== event.pointerId) return;

    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (!state.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return; // still a click
      state.moved = true;
      setDragging(true);
    }
    setPosition(clampToViewport({ x: state.originX + dx, y: state.originY + dy }));
  }, []);

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (state === null || state.pointerId !== event.pointerId) return;
    drag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (state.moved) {
      suppressClick.current = true;
      setDragging(false);
    }
  }, []);

  const consumeClick = useCallback(() => {
    if (!suppressClick.current) return false;
    suppressClick.current = false;
    return true;
  }, []);

  return { position, dragging, onPointerDown, onPointerMove, onPointerUp, consumeClick };
}
