/**
 * ChatTranscript — the message list, plus the empty state that sets
 * expectations.
 *
 * That empty state is doing real work. With template answers and no memory this
 * behaves like a natural-language SEARCH BOX, not a conversation: every question
 * is independent and "and for Dell?" will not resolve. Saying so up front is the
 * difference between "this is a neat way to query stock" and "our AI is broken"
 * — people test anything called an assistant like they test ChatGPT.
 */
import { useEffect, useRef } from 'react';

import type { ChatMessage } from '../../hooks/useChat';
import type { ChatRating } from '../../api/chat';
import { Spinner } from '../ui/Spinner';
import { ChatAnswer } from './ChatAnswer';

export interface ChatTranscriptProps {
  messages: ChatMessage[];
  pending: boolean;
  progress: string;
  onAskExample: (question: string) => void;
  onRate: (messageId: string, rating: ChatRating) => void;
}

const STARTER_QUESTIONS = [
  'How many laptops do we have?',
  'Which products are below reorder level?',
  'Show the stock movement history for the last 7 days',
];

export function ChatTranscript({
  messages,
  pending,
  progress,
  onAskExample,
  onRate,
}: ChatTranscriptProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Feature-detected: jsdom has no scrollIntoView, and a missing scroll is
    // never worth throwing inside an effect.
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length, pending]);

  if (messages.length === 0 && !pending) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-6">
        <h2 className="text-sm font-semibold text-neutral-900">Ask about your inventory</h2>
        <p className="mt-1 text-sm text-neutral-600">
          I answer from your live stock data — every number comes straight from your catalogue, not
          from a language model. I can help with:
        </p>
        <ul className="mt-3 space-y-1 text-sm text-neutral-700">
          <li>• finding products and their stock levels</li>
          <li>• what&apos;s below reorder level</li>
          <li>• stock movement history for a product</li>
        </ul>
        <p className="mt-3 text-xs text-neutral-500">
          Each question is answered on its own — follow-ups like &ldquo;and for Dell?&rdquo;
          won&apos;t carry over yet. I can&apos;t change anything, only look things up.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {STARTER_QUESTIONS.map((question) => (
            <button
              key={question}
              type="button"
              onClick={() => onAskExample(question)}
              className="rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs text-brand-800 transition-colors hover:bg-brand-100"
            >
              {question}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" aria-live="polite" aria-busy={pending}>
      {messages.map((message) => {
        if (message.kind === 'question') {
          return (
            <div key={message.id} className="flex justify-end">
              <p className="max-w-[80%] rounded-2xl rounded-br-sm bg-brand-600 px-4 py-2 text-sm text-white">
                {message.text}
              </p>
            </div>
          );
        }

        if (message.kind === 'error') {
          return (
            <div
              key={message.id}
              data-testid="chat-error"
              className="rounded-xl border border-danger-200 bg-danger-50 p-3 text-sm text-danger-800"
            >
              <p>{message.text}</p>
              {message.correlationId !== undefined && (
                <p className="mt-1 text-xs text-danger-700">Reference: {message.correlationId}</p>
              )}
            </div>
          );
        }

        return (
          <div key={message.id} data-testid="chat-answer" className="space-y-2">
            <ChatAnswer answer={message.answer} onAskExample={onAskExample} />
            <FeedbackButtons
              rating={message.rating}
              onRate={(rating) => onRate(message.id, rating)}
            />
          </div>
        );
      })}

      {pending && (
        <p className="flex items-center gap-2 text-sm text-neutral-500" data-testid="chat-progress">
          <Spinner size="sm" />
          {progress}
        </p>
      )}
      <div ref={endRef} />
    </div>
  );
}

/**
 * Thumbs up/down — the cheapest labelled data available for improving intent
 * classification, and the only reason a wrong answer ever gets reported.
 */
function FeedbackButtons({
  rating,
  onRate,
}: {
  rating: ChatRating | null;
  onRate: (rating: ChatRating) => void;
}) {
  if (rating !== null) {
    return <p className="text-xs text-neutral-500">Thanks — that helps improve the answers.</p>;
  }
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-neutral-400">Was this helpful?</span>
      <button
        type="button"
        aria-label="Helpful"
        onClick={() => onRate('up')}
        className="rounded px-1.5 py-0.5 text-sm text-neutral-500 hover:bg-neutral-100"
      >
        👍
      </button>
      <button
        type="button"
        aria-label="Not helpful"
        onClick={() => onRate('down')}
        className="rounded px-1.5 py-0.5 text-sm text-neutral-500 hover:bg-neutral-100"
      >
        👎
      </button>
    </div>
  );
}
