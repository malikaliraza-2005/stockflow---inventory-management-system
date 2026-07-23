/**
 * CI-shell seed test (Phase 0, task 0.3) — proves the unit tier executes and blocks.
 * Real content arrives with task 0.8 (validation primitives + Appendix-A vectors);
 * this file is deleted when the tier has substantive tests.
 */
import { describe, expect, it } from 'vitest';

import { SERVICE_NAME } from '../../src/index.js';

describe('unit tier substrate', () => {
  it('imports source under NodeNext resolution and asserts', () => {
    expect(SERVICE_NAME).toBe('ims-server');
  });
});
