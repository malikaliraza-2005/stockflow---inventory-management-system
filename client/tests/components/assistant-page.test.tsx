/**
 * F-CHAT — the Assistant page: the double gate, every answer shape, the
 * recovery paths, and the failure surfaces. The API module is mocked; this
 * suite owns the ORCHESTRATION (answer → rendered surfaces + wiring), not the
 * transport.
 *
 * The load-bearing assertion across all of it: every number on screen comes
 * from the typed payload, and the prose comes from the server's `summary`.
 * Nothing is composed client-side from a model string.
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

import { askAssistant, rateAnswer, type ChatResponse } from '../../src/api/chat';
import { ApiError } from '../../src/api/client';
import AssistantPage from '../../src/pages/Assistant';
import { useAuthStore } from '../../src/stores/authStore';
import { useSettingsStore } from '../../src/stores/settingsStore';

const mockedAsk = vi.mocked(askAssistant);
const mockedRate = vi.mocked(rateAnswer);

function productRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    name: 'Dell XPS 15',
    sku: 'ELEC-00001',
    categoryName: 'Electronics',
    quantity: 7,
    lowStockThreshold: 5,
    stockStatus: 'IN_STOCK' as const,
    costPrice: '10.00',
    sellingPrice: '15.50',
    isArchived: false,
    ...overrides,
  };
}

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

function renderPage() {
  return render(
    <MemoryRouter>
      <AssistantPage />
    </MemoryRouter>,
  );
}

async function ask(question: string) {
  await userEvent.type(screen.getByLabelText(/ask a question/i), question);
  await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ accessToken: null, user: null });
  useSettingsStore.getState().clear();
});

describe('the double gate', () => {
  it('hides the assistant when CHAT_ENABLED is off, even for an Admin', () => {
    signIn('ADMIN', false);
    renderPage();

    expect(screen.getByText(/isn't available for this workspace/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/ask a question/i)).not.toBeInTheDocument();
  });

  it('renders for STAFF when the flag is on (chat.use is both-roles)', () => {
    signIn('STAFF', true);
    renderPage();
    expect(screen.getByLabelText(/ask a question/i)).toBeInTheDocument();
  });
});

describe('the empty state sets expectations', () => {
  it('says what it can do, that it is read-only, and that follow-ups do not carry', () => {
    signIn();
    renderPage();

    expect(screen.getByText(/what's below reorder level/i)).toBeInTheDocument();
    expect(screen.getByText(/can't change anything, only look things up/i)).toBeInTheDocument();
    expect(screen.getByText(/won't carry over yet/i)).toBeInTheDocument();
  });

  it('starter questions are clickable and ask immediately', async () => {
    signIn();
    mockedAsk.mockResolvedValue({
      intent: 'low_stock',
      summary: 'Nothing is below its reorder level right now.',
      examples: [],
      correlationId: 'c1',
      low: [],
      out: [],
    } as ChatResponse);
    renderPage();

    await userEvent.click(
      screen.getByRole('button', { name: 'Which products are below reorder level?' }),
    );

    expect(mockedAsk).toHaveBeenCalledWith(
      expect.objectContaining({ question: 'Which products are below reorder level?' }),
    );
    expect(await screen.findByText(/nothing is below its reorder level/i)).toBeInTheDocument();
  });
});

describe('answer rendering, per intent', () => {
  it('product_lookup — summary + a product table with the real quantity and money string', async () => {
    signIn();
    mockedAsk.mockResolvedValue({
      intent: 'product_lookup',
      summary: 'Found 1 product matching "Dell". Total on hand: 7 units.',
      examples: [],
      correlationId: 'c1',
      products: [productRow()],
      totalCount: 1,
    } as ChatResponse);
    renderPage();

    await ask('how many dell');

    const answer = await screen.findByTestId('chat-answer');
    expect(within(answer).getByText(/Total on hand: 7 units\./)).toBeInTheDocument();
    expect(within(answer).getAllByText('Dell XPS 15').length).toBeGreaterThan(0);
    // Money passes through as the server's 2-dp string — never Number(price).
    expect(within(answer).getAllByText('$15.50').length).toBeGreaterThan(0);
    expect(within(answer).getAllByText('In stock').length).toBeGreaterThan(0);
  });

  it('low_stock — renders BOTH buckets, out-of-stock first', async () => {
    signIn();
    mockedAsk.mockResolvedValue({
      intent: 'low_stock',
      summary: '1 product is at or below its reorder level, and 1 is out of stock.',
      examples: [],
      correlationId: 'c1',
      low: [productRow({ id: 'p2', name: 'Low Widget', quantity: 3, stockStatus: 'LOW_STOCK' })],
      out: [
        productRow({ id: 'p3', name: 'Empty Widget', quantity: 0, stockStatus: 'OUT_OF_STOCK' }),
      ],
    } as ChatResponse);
    renderPage();

    await ask('what needs reordering');

    const answer = await screen.findByTestId('chat-answer');
    const headings = within(answer).getAllByRole('heading', { level: 3 });
    expect(headings.map((h) => h.textContent)).toEqual(['Out of stock', 'Below reorder level']);
  });

  it('movement_history — the resolved product and its ledger rows, signed', async () => {
    signIn();
    mockedAsk.mockResolvedValue({
      intent: 'movement_history',
      summary: '1 stock movement for "Dell XPS 15" in the last 30 days: 1 stock-in.',
      examples: [],
      correlationId: 'c1',
      product: productRow(),
      totalCount: 1,
      movements: [
        {
          id: 't1',
          createdAt: '2026-07-25T11:00:00.000Z',
          productId: 'p1',
          productName: 'Dell XPS 15',
          productSku: 'ELEC-00001',
          productArchived: false,
          type: 'STOCK_IN',
          quantityChange: 5,
          quantityAfter: 12,
          userId: 'u1',
          userName: 'Ada',
        },
      ],
    } as ChatResponse);
    renderPage();

    await ask('history for dell');

    const answer = await screen.findByTestId('chat-answer');
    expect(within(answer).getAllByText('+5').length).toBeGreaterThan(0);
    expect(within(answer).getAllByText('Ada').length).toBeGreaterThan(0);
  });

  it('clarify — lists candidates instead of an answer', async () => {
    signIn();
    mockedAsk.mockResolvedValue({
      intent: 'clarify',
      summary: 'I found 2 products matching "Dell". Which one did you mean?',
      examples: [],
      correlationId: 'c1',
      candidates: [productRow(), productRow({ id: 'p2', name: 'Dell XPS 13' })],
    } as ChatResponse);
    renderPage();

    await ask('history for dell');

    const answer = await screen.findByTestId('chat-answer');
    expect(within(answer).getByText(/Which one did you mean\?/)).toBeInTheDocument();
    expect(within(answer).getAllByRole('heading', { level: 3 })[0]).toHaveTextContent(
      'Did you mean',
    );
  });

  it('unsupported — the capability list survives its newlines', async () => {
    signIn();
    mockedAsk.mockResolvedValue({
      intent: 'unsupported',
      summary:
        "I can't answer that one. I can help with:\n• finding products and their stock levels",
      examples: ['How many laptops do we have?'],
      correlationId: 'c1',
      capabilities: ['finding products and their stock levels'],
    } as ChatResponse);
    renderPage();

    await ask('tell me a joke');

    const answer = await screen.findByTestId('chat-answer');
    expect(within(answer).getByText(/I can't answer that one/)).toBeInTheDocument();
  });
});

describe('recovery paths', () => {
  it('a zero-result answer offers clickable example questions that re-ask', async () => {
    signIn();
    mockedAsk
      .mockResolvedValueOnce({
        intent: 'product_lookup',
        summary: 'No products matched "Lenovo". Try a shorter term.',
        examples: ['How many laptops do we have?'],
        correlationId: 'c1',
        products: [],
        totalCount: 0,
      } as ChatResponse)
      .mockResolvedValueOnce({
        intent: 'product_lookup',
        summary: 'Found 1 product matching "laptop". Total on hand: 7 units.',
        examples: [],
        correlationId: 'c2',
        products: [productRow()],
        totalCount: 1,
      } as ChatResponse);
    renderPage();

    await ask('any lenovo');
    await userEvent.click(
      await screen.findByRole('button', { name: 'How many laptops do we have?' }),
    );

    expect(mockedAsk).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(/Total on hand: 7 units\./)).toBeInTheDocument();
  });
});

describe('failure surfaces', () => {
  it('a 503 reads as "unavailable" in the transcript, next to the question', async () => {
    signIn();
    mockedAsk.mockRejectedValue(
      new ApiError({
        code: 'SERVICE_UNAVAILABLE',
        message: 'The assistant is unavailable right now.',
        status: 503,
        correlationId: 'corr-9',
      }),
    );
    renderPage();

    await ask('how many laptops');

    const error = await screen.findByTestId('chat-error');
    expect(within(error).getByText(/unavailable right now/i)).toBeInTheDocument();
    expect(within(error).getByText(/Reference: corr-9/)).toBeInTheDocument();
    // The question stays on screen so the failure has context.
    expect(screen.getByText('how many laptops')).toBeInTheDocument();
  });
});

describe('feedback', () => {
  it('records a thumbs rating against the answer correlationId', async () => {
    signIn();
    mockedAsk.mockResolvedValue({
      intent: 'unsupported',
      summary: "I can't answer that one.",
      examples: [],
      correlationId: 'corr-42',
      capabilities: [],
    } as ChatResponse);
    renderPage();

    await ask('tell me a joke');
    await userEvent.click(await screen.findByRole('button', { name: 'Not helpful' }));

    expect(mockedRate).toHaveBeenCalledWith('corr-42', 'down');
    expect(screen.getByText(/thanks — that helps/i)).toBeInTheDocument();
  });
});
