/**
 * CI-shell seed test (Phase 0, task 0.3) — proves the component tier executes and
 * blocks (jsdom + Testing Library substrate). Real domain-component contract tests
 * arrive with their components (UCA) from Phase 1 onward.
 */
import { render, screen } from '@testing-library/react';

import App from '../../src/App';

describe('component tier substrate', () => {
  it('renders the walking-skeleton root', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'StockFlow — Inventory Management System',
    );
  });
});
