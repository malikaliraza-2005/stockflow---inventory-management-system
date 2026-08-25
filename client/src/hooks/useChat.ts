/**
 * useChat — the whole client-side state machine for the assistant.
 *
 * Single-turn by design: each question is independent and nothing is carried
 * between them, because the server has no memory in Phase 1. The transcript is
 * kept purely so the user can re-read earlier answers — "and for Dell?" will
 * not resolve, and the empty state says so rather than letting people discover
 * it by being confused.
 *
 * `conversationId` is generated once per mount and sent with every question. It
 * is a server LOG field only; it exists so question SEQUENCES can be
 * reconstructed later, which is the strongest signal for what to build next.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '../api/client';
import { askAssistant, rateAnswer, type ChatRating, type ChatResponse } from '../api/chat';

export interface UserMessage {
  kind: 'question';
  id: string;
  text: string;
}

export interface AnswerMessage {
  kind: 'answer';
  id: string;
  answer: ChatResponse;
  rating: ChatRating | null;
}

export interface ErrorMessage {
  kind: 'error';
  id: string;
  text: string;
  correlationId: string | undefined;
}

export type ChatMessage = UserMessage | AnswerMessage | ErrorMessage;

/**
 * Staged progress text. One line that never changes for two seconds reads as a
 * hang; naming the actual stages also teaches people what the assistant does —
 * which is why the second stage says "searching your inventory", not "thinking".
 */
const PROGRESS_STAGES = ['Understanding your question…', 'Searching your inventory…'] as const;
const STAGE_ADVANCE_MS = 900;

function newId(): string {
  return crypto.randomUUID();
}

export interface UseChat {
  messages: ChatMessage[];
  pending: boolean;
  progress: string;
  conversationId: string;
  ask: (question: string) => Promise<void>;
  rate: (messageId: string, rating: ChatRating) => void;
  reset: () => void;
}

export function useChat(): UseChat {
  const [conversationId, setConversationId] = useState(newId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [stage, setStage] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearInterval(timer.current);
    },
    [],
  );

  const ask = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (trimmed === '' || pending) return;

      setMessages((prev) => [...prev, { kind: 'question', id: newId(), text: trimmed }]);
      setPending(true);
      setStage(0);
      timer.current = setInterval(() => {
        setStage((s) => Math.min(s + 1, PROGRESS_STAGES.length - 1));
      }, STAGE_ADVANCE_MS);

      try {
        const answer = await askAssistant({ conversationId, question: trimmed });
        setMessages((prev) => [
          ...prev,
          { kind: 'answer', id: answer.correlationId, answer, rating: null },
        ]);
      } catch (error) {
        // A provider outage is a 503 with a real message from the server; keep
        // it in the transcript rather than a toast so the question it belongs to
        // stays visible next to it.
        const apiError = error instanceof ApiError ? error : null;
        setMessages((prev) => [
          ...prev,
          {
            kind: 'error',
            id: newId(),
            text:
              apiError?.code === 'SERVICE_UNAVAILABLE'
                ? 'The assistant is unavailable right now. Please try again in a moment.'
                : (apiError?.message ?? 'Something went wrong. Please try again.'),
            correlationId: apiError?.correlationId,
          },
        ]);
      } finally {
        if (timer.current !== null) clearInterval(timer.current);
        timer.current = null;
        setPending(false);
      }
    },
    [conversationId, pending],
  );

  const rate = useCallback((messageId: string, rating: ChatRating) => {
    setMessages((prev) =>
      prev.map((message) =>
        message.kind === 'answer' && message.id === messageId ? { ...message, rating } : message,
      ),
    );
    void rateAnswer(messageId, rating);
  }, []);

  const reset = useCallback(() => {
    setMessages([]);
    setConversationId(newId()); // a new conversation, so the logged sequence breaks here too
  }, []);

  return {
    messages,
    pending,
    progress: PROGRESS_STAGES[stage] ?? PROGRESS_STAGES[0],
    conversationId,
    ask,
    rate,
    reset,
  };
}
