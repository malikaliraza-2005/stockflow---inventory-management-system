/**
 * ChatWidget — the floating bubble that is the assistant's real entry point.
 *
 * What matters here is the GATE and the open/close contract, not the answer
 * rendering (assistant-page.test.tsx owns that, through the same components).
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000');

vi.mock('../../src/api/chat', async () => {
  const actual = await vi.importActual<typeof import('../../src/api/chat')>('../../src/api/chat');
  return { ...actual, askAssistant: vi.fn(), rateAnswer: vi.fn() };
});

import { askAssistant, type ChatResponse } from '../../src/api/chat';
import { ChatWidget } from '../../src/components/domain/ChatWidget';
import { useAuthStore } from '../../src/stores/authStore';
import { useSettingsStore } from '../../src/stores/settingsStore';

const mockedAsk = vi.mocked(askAssistant);

function signIn(role: 'ADMIN' | 'STAFF' = 'STAFF', chatEnabled = true) {
  useAuthStore.setState({
    accessToken: 'token',
    user: { id: 'u1', name: 'Sara An', email: 's@example.com', role, isActive: true } as never,
  });
  useSettingsStore.setState({
    currency: 'USD',
    defaultLowStockThreshold: 10,
    movementWarningThreshold: 1000,
    chatEnabled,
    loaded: true,
  });
}

function renderWidget() {
  return render(
    <MemoryRouter>
      <ChatWidget />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ accessToken: null, user: null });
  useSettingsStore.getState().clear();
});

describe('the gate', () => {
  it('renders NOTHING when CHAT_ENABLED is off — not a disabled bubble', () => {
    // A control you cannot use reads as broken rather than absent.
    signIn('ADMIN', false);
    renderWidget();
    expect(screen.queryByTestId('chat-bubble')).not.toBeInTheDocument();
  });

  it('renders nothing for a role without chat.use', () => {
    useAuthStore.setState({
      accessToken: 'token',
      user: { id: 'u1', name: 'X', email: 'x@e.com', role: 'VIEWER', isActive: true } as never,
    });
    useSettingsStore.setState({ chatEnabled: true, loaded: true } as never);
    renderWidget();
    expect(screen.queryByTestId('chat-bubble')).not.toBeInTheDocument();
  });

  it('shows the bubble for STAFF with the flag on', () => {
    signIn('STAFF', true);
    renderWidget();
    expect(screen.getByTestId('chat-bubble')).toBeInTheDocument();
  });
});

describe('open / close', () => {
  it('starts closed, opens on click, and reports its state to assistive tech', async () => {
    signIn();
    renderWidget();

    const bubble = screen.getByTestId('chat-bubble');
    expect(bubble).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('chat-panel')).not.toBeInTheDocument();

    await userEvent.click(bubble);

    expect(bubble).toHaveAttribute('aria-expanded', 'true');
    const panel = screen.getByTestId('chat-panel');
    expect(within(panel).getByRole('heading', { name: 'Inventory assistant' })).toBeInTheDocument();
    expect(within(panel).getByLabelText(/ask a question/i)).toBeInTheDocument();
  });

  it('closes on Escape and on the close button', async () => {
    signIn();
    renderWidget();

    await userEvent.click(screen.getByTestId('chat-bubble'));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByTestId('chat-panel')).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId('chat-bubble'));
    await userEvent.click(screen.getByRole('button', { name: 'Close assistant' }));
    expect(screen.queryByTestId('chat-panel')).not.toBeInTheDocument();
  });

  it('keeps the transcript across a close/reopen — the panel is not a modal you lose', async () => {
    signIn();
    mockedAsk.mockResolvedValue({
      intent: 'low_stock',
      summary: 'Nothing is below its reorder level right now.',
      examples: [],
      correlationId: 'c1',
      low: [],
      out: [],
    } as ChatResponse);
    renderWidget();

    await userEvent.click(screen.getByTestId('chat-bubble'));
    await userEvent.type(screen.getByLabelText(/ask a question/i), 'what needs reordering');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByText(/nothing is below its reorder level/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Close assistant' }));
    await userEvent.click(screen.getByTestId('chat-bubble'));

    expect(screen.getByText(/nothing is below its reorder level/i)).toBeInTheDocument();
  });

  it('"New chat" appears only once there is something to clear', async () => {
    signIn();
    mockedAsk.mockResolvedValue({
      intent: 'unsupported',
      summary: "I can't answer that one.",
      examples: [],
      correlationId: 'c1',
      capabilities: [],
    } as ChatResponse);
    renderWidget();

    await userEvent.click(screen.getByTestId('chat-bubble'));
    expect(screen.queryByRole('button', { name: 'New chat' })).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/ask a question/i), 'tell me a joke');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await screen.findByTestId('chat-answer');

    await userEvent.click(screen.getByRole('button', { name: 'New chat' }));
    expect(screen.queryByTestId('chat-answer')).not.toBeInTheDocument();
    expect(screen.getByText(/ask about your inventory/i)).toBeInTheDocument();
  });
});
