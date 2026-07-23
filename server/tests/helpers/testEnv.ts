/**
 * Shared AppEnv fixture — the env slice createApp consumes, with generous
 * limiter budgets so suites never trip 429 accidentally. Suites that TEST the
 * limiters override the strict values explicitly.
 */
import type { AppEnv } from '../../src/app.js';

export const TEST_ACCESS_SECRET = 'integration-test-access-secret-32ch!';

export function makeTestEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    NODE_ENV: 'test',
    JWT_ACCESS_SECRET: TEST_ACCESS_SECRET,
    ACCESS_TOKEN_TTL: '15m',
    REFRESH_TOKEN_TTL: '7d',
    CORS_ORIGIN: 'http://localhost:5173',
    RATE_LIMIT_GLOBAL_MAX: 100_000,
    RATE_LIMIT_GLOBAL_WINDOW_MS: 900_000,
    RATE_LIMIT_STRICT_MAX: 100_000,
    RATE_LIMIT_STRICT_WINDOW_MS: 900_000,
    ...overrides,
  };
}
