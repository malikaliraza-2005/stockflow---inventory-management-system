/**
 * ChatWidget — the assistant's entry point: a floating bubble in the brand
 * violet, and the panel it opens.
 *
 * A bubble rather than a sidebar row because the assistant answers questions
 * ABOUT the page you are already on ("is this thing low?", "what moved?"), and
 * a nav row would make you leave that page to ask. It is mounted once in
 * AppShell, so it follows you everywhere.
 *
 * Double-gated exactly like the page: `chat.use` from the generated matrix AND
 * the session's `chatEnabled` flag. When either is false NOTHING renders — no
 * disabled bubble, no tooltip. A control you cannot use is worse than no
 * control, because it reads as broken rather than absent.
 *
 * The panel is deliberately NOT a modal: it does not trap focus or block the
 * page behind it, because reading a product row while asking about it is the
 * whole point. Escape closes it.
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react';

import { useChat } from '../../hooks/useChat';
import { usePermission } from '../../hooks/usePermission';
import { BUBBLE_SIZE, useDraggableBubble } from '../../hooks/useDraggableBubble';
import { selectChatEnabled, useSettingsStore } from '../../stores/settingsStore';
import { ChatComposer } from './ChatComposer';
import { ChatTranscript } from './ChatTranscript';

/** Panel box on ≥ sm. Mirrors the Tailwind classes used in the default corner. */
const PANEL_WIDTH = 416; // w-[26rem]
const PANEL_MAX_HEIGHT = 608; // 38rem
const PANEL_GAP = 12;
const EDGE_MARGIN = 16;
const SM_BREAKPOINT = 640;

export function ChatWidget() {
  const can = usePermission();
  const chatEnabled = useSettingsStore(selectChatEnabled);
  const [open, setOpen] = useState(false);
  const { messages, pending, progress, ask, rate, reset } = useChat();
  const { position, dragging, onPointerDown, onPointerMove, onPointerUp, consumeClick } =
    useDraggableBubble();
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  /**
   * Once the bubble has been moved, the panel follows it — a panel that opens
   * in the corner while the bubble sits elsewhere reads as two unrelated
   * things. Prefers opening ABOVE the bubble, falls back to below, and clamps
   * both axes so it can never hang off-screen.
   *
   * Below `sm` the panel is a full-width sheet regardless: there is no room for
   * it to be anywhere else, and anchoring it would only push it off the edge.
   */
  const panelStyle = useMemo<CSSProperties | undefined>(() => {
    if (position === null || viewport.width < SM_BREAKPOINT) return undefined;

    const height = Math.min(viewport.height * 0.7, PANEL_MAX_HEIGHT);
    const above = position.y - PANEL_GAP - height;
    const top =
      above >= EDGE_MARGIN
        ? above
        : Math.min(position.y + BUBBLE_SIZE + PANEL_GAP, viewport.height - height - EDGE_MARGIN);
    const left = Math.min(
      Math.max(position.x + BUBBLE_SIZE - PANEL_WIDTH, EDGE_MARGIN),
      viewport.width - PANEL_WIDTH - EDGE_MARGIN,
    );
    return { top, left, width: PANEL_WIDTH, height };
  }, [position, viewport]);

  const bubbleStyle: CSSProperties | undefined =
    position === null ? undefined : { top: position.y, left: position.x };

  if (!can('chat.use') || !chatEnabled) return null;

  return (
    <>
      {open && (
        <div
          role="dialog"
          aria-label="Inventory assistant"
          data-testid="chat-panel"
          style={panelStyle}
          className={
            panelStyle === undefined
              ? 'fixed inset-x-3 bottom-24 top-16 z-40 flex flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl sm:inset-x-auto sm:right-6 sm:top-auto sm:h-[min(70vh,38rem)] sm:w-[26rem] md:bottom-24'
              : 'fixed z-40 flex flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl'
          }
        >
          <header className="flex items-center justify-between gap-2 bg-linear-to-b from-brand-600 to-brand-700 px-4 py-3 text-white">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold">Inventory assistant</h2>
              <p className="truncate text-xs text-brand-100">
                Answers from your live stock — read-only
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={reset}
                  className="rounded-md px-2 py-1 text-xs text-brand-100 transition-colors hover:bg-white/15 hover:text-white"
                >
                  New chat
                </button>
              )}
              <button
                type="button"
                aria-label="Close assistant"
                onClick={() => setOpen(false)}
                className="rounded-md p-1.5 text-brand-100 transition-colors hover:bg-white/15 hover:text-white"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  aria-hidden="true"
                  className="h-4 w-4"
                >
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto bg-neutral-50 p-3">
            <ChatTranscript
              messages={messages}
              pending={pending}
              progress={progress}
              onAskExample={ask}
              onRate={rate}
            />
          </div>

          <div className="border-t border-neutral-200 bg-white p-3">
            <ChatComposer
              inputId="assistant-widget-question"
              pending={pending}
              onAsk={ask}
              autoFocus
            />
          </div>
        </div>
      )}

      {/* Until it is dragged it sits ABOVE the mobile bottom nav (< md) and clear
          of the edge on desktop; once dragged, an inline top/left wins and the
          corner classes are dropped so they cannot fight it. */}
      <button
        type="button"
        aria-label={open ? 'Close inventory assistant' : 'Open inventory assistant'}
        aria-expanded={open}
        data-testid="chat-bubble"
        style={bubbleStyle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        // A drop fires `click` too — swallow that one so dropping the bubble
        // does not also open the panel.
        onClick={() => {
          if (consumeClick()) return;
          setOpen((value) => !value);
        }}
        className={`fixed z-50 flex h-14 w-14 touch-none items-center justify-center rounded-full bg-linear-to-b from-brand-500 to-brand-600 text-white shadow-lg shadow-brand-600/30 transition-shadow duration-150 select-none hover:from-brand-600 hover:to-brand-700 hover:shadow-xl ${
          position === null ? 'bottom-20 right-4 md:bottom-6 md:right-6' : ''
        } ${dragging ? 'cursor-grabbing shadow-xl' : 'cursor-grab'}`}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.7}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="h-6 w-6"
        >
          {open ? (
            <path d="M6 6l12 12M18 6L6 18" />
          ) : (
            <path d="M20 12a7 7 0 0 1-7 7H8.5L4 21.5V12a7 7 0 0 1 7-7h2a7 7 0 0 1 7 7Zm-8.6 0a2.1 2.1 0 1 0 4.2 0 2.1 2.1 0 0 0-4.2 0Zm3.6 1.6 1.6 1.6" />
          )}
        </svg>
      </button>
    </>
  );
}
