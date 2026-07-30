/**
 * ChatWidget — the floating bubble that is the assistant's real entry point.
 *
 * What matters here is the GATE and the open/close contract, not the answer
 * rendering (assistant-page.test.tsx owns that, through the same components).
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000');

/**
 * jsdom implements no PointerEvent, so Testing Library falls back to a bare
 * `Event` and silently DROPS clientX/pointerId — every drag would arrive as
 * NaN. MouseEvent already carries the coordinates; this only adds the two
 * pointer fields on top.
 */
class PointerEventPolyfill extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;

  constructor(
    type: string,
    init: MouseEventInit & { pointerId?: number; pointerType?: string } = {},
  ) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.pointerType = init.pointerType ?? 'mouse';
  }
}
window.PointerEvent = PointerEventPolyfill as unknown as typeof window.PointerEvent;

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
  // The bubble position PERSISTS by design — so it must be cleared between
  // tests, or one test's drag becomes the next test's starting state.
  window.localStorage.clear();
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
  it('starts closed, opens on click, and hands off to the panel', async () => {
    signIn();
    renderWidget();

    const bubble = screen.getByTestId('chat-bubble');
    expect(bubble).toHaveAttribute('aria-haspopup', 'dialog');
    expect(screen.queryByTestId('chat-panel')).not.toBeInTheDocument();

    await userEvent.click(bubble);

    // The bubble is the OPEN control only — it disappears behind the panel so
    // there is exactly one close affordance on screen, not two.
    expect(screen.queryByTestId('chat-bubble')).not.toBeInTheDocument();
    const panel = screen.getByTestId('chat-panel');
    expect(within(panel).getByRole('heading', { name: 'Inventory assistant' })).toBeInTheDocument();
    expect(within(panel).getByLabelText(/ask a question/i)).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Close assistant' })).toBeInTheDocument();
  });

  it('closes on a click anywhere OUTSIDE the panel', async () => {
    signIn();
    const { container } = render(
      <MemoryRouter>
        <div data-testid="page-behind">the page</div>
        <ChatWidget />
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByTestId('chat-bubble'));
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('page-behind'));
    expect(screen.queryByTestId('chat-panel')).not.toBeInTheDocument();
    expect(container).toBeTruthy();
  });

  it('does NOT close on a click inside the panel', async () => {
    signIn();
    renderWidget();

    await userEvent.click(screen.getByTestId('chat-bubble'));
    // Typing, clicking the transcript, hitting a starter question — all inside.
    await userEvent.click(screen.getByLabelText(/ask a question/i));
    await userEvent.click(screen.getByRole('heading', { name: 'Inventory assistant' }));

    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
  });

  it('the click that OPENS it does not immediately close it', async () => {
    // The click-away listener is registered from an effect, so it is only live
    // after the opening render commits — otherwise the opening click would be
    // seen as an outside click and the panel would never appear.
    signIn();
    renderWidget();

    await userEvent.click(screen.getByTestId('chat-bubble'));

    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
  });

  it('the bubble comes back when the panel closes', async () => {
    signIn();
    renderWidget();

    await userEvent.click(screen.getByTestId('chat-bubble'));
    await userEvent.click(screen.getByRole('button', { name: 'Close assistant' }));

    expect(screen.getByTestId('chat-bubble')).toBeInTheDocument();
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

describe('dragging the bubble', () => {
  /** jsdom reports a 0x0 rect, so origin is (0,0) and the delta IS the position. */
  function dragBy(dx: number, dy: number) {
    const bubble = screen.getByTestId('chat-bubble');
    fireEvent.pointerDown(bubble, {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerMove(bubble, { pointerId: 1, clientX: dx, clientY: dy });
    fireEvent.pointerUp(bubble, { pointerId: 1, clientX: dx, clientY: dy });
    return bubble;
  }

  it('lays down a smoke trail while dragging, and none before', () => {
    signIn();
    renderWidget();

    expect(screen.queryByTestId('chat-bubble-smoke')).not.toBeInTheDocument();

    const bubble = screen.getByTestId('chat-bubble');
    fireEvent.pointerDown(bubble, {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerMove(bubble, { pointerId: 1, clientX: 60, clientY: 40 });
    fireEvent.pointerMove(bubble, { pointerId: 1, clientX: 120, clientY: 90 });
    fireEvent.pointerMove(bubble, { pointerId: 1, clientX: 200, clientY: 150 });

    const trail = screen.getByTestId('chat-bubble-smoke');
    // One puff per EMIT_DISTANCE travelled — jsdom never fires animationend, so
    // nothing self-removes and the count is exactly what was emitted.
    expect(trail.childElementCount).toBe(3);
    // A decorative layer must never swallow the drag it is decorating.
    expect(trail).toHaveClass('pointer-events-none');
    expect(trail).toHaveAttribute('aria-hidden', 'true');
  });

  it('emits nothing for a sub-threshold wobble', () => {
    signIn();
    renderWidget();

    const bubble = screen.getByTestId('chat-bubble');
    fireEvent.pointerDown(bubble, {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(bubble, { pointerId: 1, clientX: 11, clientY: 11 });
    fireEvent.pointerUp(bubble, { pointerId: 1, clientX: 11, clientY: 11 });

    expect(screen.queryByTestId('chat-bubble-smoke')).not.toBeInTheDocument();
  });

  it('moves the bubble and does NOT open the panel on drop', () => {
    signIn();
    renderWidget();

    const bubble = dragBy(300, 200);

    expect(bubble.style.left).toBe('300px');
    expect(bubble.style.top).toBe('200px');
    // The click that follows the drop is swallowed.
    fireEvent.click(bubble);
    expect(screen.queryByTestId('chat-panel')).not.toBeInTheDocument();
  });

  it('treats a sub-threshold wobble as a CLICK, not a drag', async () => {
    signIn();
    renderWidget();

    const bubble = screen.getByTestId('chat-bubble');
    fireEvent.pointerDown(bubble, {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(bubble, { pointerId: 1, clientX: 11, clientY: 11 }); // ~1.4px
    fireEvent.pointerUp(bubble, { pointerId: 1, clientX: 11, clientY: 11 });

    expect(bubble.style.left).toBe(''); // never moved — keeps its corner classes
    await userEvent.click(bubble);
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
  });

  it('clamps to the viewport so it can never be dragged out of reach', () => {
    signIn();
    renderWidget();

    // jsdom viewport is 1024x768; 56px bubble, 16px margin -> max 952 / 696.
    const bubble = dragBy(9999, 9999);
    expect(bubble.style.left).toBe('952px');
    expect(bubble.style.top).toBe('696px');
  });

  it('remembers the position across a remount, and re-clamps on resize', () => {
    signIn();
    const first = renderWidget();
    dragBy(400, 300);
    first.unmount();

    renderWidget();
    const bubble = screen.getByTestId('chat-bubble');
    expect(bubble.style.left).toBe('400px');

    // Shrinking the window must not strand it off-screen.
    window.innerWidth = 500;
    window.innerHeight = 400;
    fireEvent(window, new Event('resize'));
    expect(Number.parseInt(bubble.style.left, 10)).toBeLessThanOrEqual(500 - 56 - 16);
    window.innerWidth = 1024;
    window.innerHeight = 768;
  });

  it('opens the panel anchored to the dragged bubble, not the corner', () => {
    signIn();
    renderWidget();

    const bubble = dragBy(600, 500);
    fireEvent.click(bubble); // swallowed drop-click
    fireEvent.click(bubble); // real click

    const panel = screen.getByTestId('chat-panel');
    // 26rem panel, right edge aligned to the bubble's right edge: 600 + 56 - 416.
    expect(panel.style.left).toBe('240px');
    expect(panel).not.toHaveClass('bottom-24');
  });
});
