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
    ATLAS_SEARCH_ENABLED: false, // suites exercise the regex fallback (no Atlas locally)
    CLOUDINARY_CLOUD_NAME: 'test-cloud',
    CLOUDINARY_API_KEY: 'test-key',
    CLOUDINARY_API_SECRET: 'test-secret',
    CLOUDINARY_DELIVERY_HOST: 'res.cloudinary.com',
    // Chat is ON in tests (suites that assert the dark state override it), with
    // the fake provider — no network, no key, no quota.
    CHAT_ENABLED: true,
    LLM_PROVIDER: 'fake',
    LLM_MODEL: 'fake-1',
    LLM_MAX_TOKENS: 256,
    LLM_TIMEOUT_MS: 5_000,
    RATE_LIMIT_CHAT_MAX: 100_000,
    RATE_LIMIT_CHAT_WINDOW_MS: 900_000,
    ...overrides,
  };
}
