/**
 * Assistant page — the full-window view of the read-only AI inventory
 * assistant. The primary entry point is the floating ChatWidget in AppShell;
 * this route stays for deep links and for reading a long answer with room to
 * breathe, and both share `useChat` and `ChatComposer` so they cannot drift.
 *
 * Double-gated: `chat.use` from the generated permission matrix (FD-3 — a
 * capability question, never an inline role comparison) AND `chatEnabled` from
 * the session's settings block. The second gate is what makes "ship dark" real:
 * the server can be toggled without a client deploy.
 */
import { ChatComposer } from '../../components/domain/ChatComposer';
import { ChatTranscript } from '../../components/domain/ChatTranscript';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { useChat } from '../../hooks/useChat';
import { usePermission } from '../../hooks/usePermission';
import { selectChatEnabled, useSettingsStore } from '../../stores/settingsStore';

export default function AssistantPage() {
  const can = usePermission();
  const chatEnabled = useSettingsStore(selectChatEnabled);
  const { messages, pending, progress, ask, rate, reset } = useChat();

  if (!can('chat.use') || !chatEnabled) {
    return <EmptyState message="The inventory assistant isn't available for this workspace." />;
  }

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
        onAskExample={ask}
        onRate={rate}
      />

      <div className="sticky bottom-0 bg-neutral-50 py-2">
        <ChatComposer inputId="assistant-page-question" pending={pending} onAsk={ask} />
      </div>
    </div>
  );
}
