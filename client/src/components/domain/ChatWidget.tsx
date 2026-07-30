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
import { useEffect, useState } from 'react';

import { useChat } from '../../hooks/useChat';
import { usePermission } from '../../hooks/usePermission';
import { selectChatEnabled, useSettingsStore } from '../../stores/settingsStore';
import { ChatComposer } from './ChatComposer';
import { ChatTranscript } from './ChatTranscript';

export function ChatWidget() {
  const can = usePermission();
  const chatEnabled = useSettingsStore(selectChatEnabled);
  const [open, setOpen] = useState(false);
  const { messages, pending, progress, ask, rate, reset } = useChat();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (!can('chat.use') || !chatEnabled) return null;

  return (
    <>
      {open && (
        <div
          role="dialog"
          aria-label="Inventory assistant"
          data-testid="chat-panel"
          className="fixed inset-x-3 bottom-24 top-16 z-40 flex flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl sm:inset-x-auto sm:right-6 sm:top-auto sm:h-[min(70vh,38rem)] sm:w-[26rem] md:bottom-24"
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

      {/* Sits ABOVE the mobile bottom nav (< md), and clear of the edge on desktop. */}
      <button
        type="button"
        aria-label={open ? 'Close inventory assistant' : 'Open inventory assistant'}
        aria-expanded={open}
        data-testid="chat-bubble"
        onClick={() => setOpen((value) => !value)}
        className="fixed bottom-20 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-linear-to-b from-brand-500 to-brand-600 text-white shadow-lg shadow-brand-600/30 transition-all duration-150 hover:from-brand-600 hover:to-brand-700 hover:shadow-xl active:translate-y-px md:bottom-6 md:right-6"
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
