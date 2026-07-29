/**
 * Assistant page — the read-only AI inventory assistant.
 *
 * Double-gated: `chat.use` from the generated permission matrix (FD-3 — a
 * capability question, never an inline role comparison) AND `chatEnabled` from
 * the session's settings block. The second gate is what makes "ship dark" real:
 * the server can be toggled without a client deploy, and a client that somehow
 * renders anyway hits a 404, not a broken page.
 */
import { useState, type FormEvent } from 'react';

import { ChatTranscript } from '../../components/domain/ChatTranscript';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { useChat } from '../../hooks/useChat';
import { usePermission } from '../../hooks/usePermission';
import { selectChatEnabled, useSettingsStore } from '../../stores/settingsStore';

/** Mirrors the server's `question` bound (VAL) so the cap is visible, not a 400. */
const MAX_QUESTION = 500;

export default function AssistantPage() {
  const can = usePermission();
  const chatEnabled = useSettingsStore(selectChatEnabled);
  const { messages, pending, progress, ask, rate, reset } = useChat();
  const [draft, setDraft] = useState('');

  if (!can('chat.use') || !chatEnabled) {
    return <EmptyState message="The inventory assistant isn't available for this workspace." />;
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const question = draft;
    setDraft('');
    void ask(question);
  };

  const askExample = (question: string) => {
    setDraft('');
    void ask(question);
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">Inventory assistant</h1>
          <p className="text-sm text-neutral-600">
            Natural-language search over your stock. Read-only — it can look things up, never change
            them.
          </p>
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" onClick={reset}>
            New chat
          </Button>
        )}
      </header>

      <ChatTranscript
        messages={messages}
        pending={pending}
        progress={progress}
        onAskExample={askExample}
        onRate={rate}
      />

      <form onSubmit={submit} className="sticky bottom-0 flex gap-2 bg-neutral-50 py-2">
        <label htmlFor="assistant-question" className="sr-only">
          Ask a question about your inventory
        </label>
        <input
          id="assistant-question"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={MAX_QUESTION}
          autoComplete="off"
          placeholder="How many laptops do we have?"
          className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm shadow-xs focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
        />
        <Button type="submit" loading={pending} disabled={draft.trim().length < 2}>
          Ask
        </Button>
      </form>
    </div>
  );
}
