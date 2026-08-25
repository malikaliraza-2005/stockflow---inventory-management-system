/**
 * ChatComposer — the question input, shared by the floating widget and the
 * standalone /assistant page so the two can never drift in what they accept.
 *
 * `maxLength` mirrors the server's own bound: a cap the user can feel while
 * typing is better than a 400 after they press Ask.
 */
import { useState, type FormEvent } from 'react';

import { Button } from '../ui/Button';

/** Mirrors the server's `question` bound in validation/schemas/chat.ts. */
const MAX_QUESTION = 500;
const MIN_QUESTION = 2;

export interface ChatComposerProps {
  pending: boolean;
  onAsk: (question: string) => void;
  /** Unique per mount — the widget and the page can be on screen together. */
  inputId?: string;
  autoFocus?: boolean;
}

export function ChatComposer({
  pending,
  onAsk,
  inputId = 'assistant-question',
  autoFocus = false,
}: ChatComposerProps) {
  const [draft, setDraft] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const question = draft;
    setDraft('');
    onAsk(question);
  };

  return (
    <form onSubmit={submit} className="flex gap-2">
      <label htmlFor={inputId} className="sr-only">
        Ask a question about your inventory
      </label>
      <input
        id={inputId}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        maxLength={MAX_QUESTION}
        autoComplete="off"
        // Autofocus only where the user just opened a panel to type into — never
        // on page load, which would steal the caret from someone reading.
        autoFocus={autoFocus}
        placeholder="How many laptops do we have?"
        className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm shadow-xs focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
      />
      <Button type="submit" loading={pending} disabled={draft.trim().length < MIN_QUESTION}>
        Ask
      </Button>
    </form>
  );
}
