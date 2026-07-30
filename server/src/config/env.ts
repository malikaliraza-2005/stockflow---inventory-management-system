/**
 * Environment schema validation — NFR-28 / DEP §7 / SEC-10.
 *
 * Every configuration value enters through this module. Validation is fail-fast
 * and exhaustive: ALL violations are collected and reported together, each one
 * naming its variable — never echoing its value (secrets must not reach logs).
 *
 * Boot wiring (DEP §5: config validation → Mongo connect → integrity check →
 * listen) arrives with task 0.10; until then consumers call `env()` lazily.
 */
import { z } from 'zod';

import { LLM_PROVIDERS } from '../services/llm/providers/index.js';

/** `15m`, `7d`, `900s`, `250ms` … — the TTL grammar of SRS §18.4 */
const DURATION_PATTERN = /^\d+(ms|s|m|h|d)$/;
const DURATION_MESSAGE = 'must be a duration like 15m, 7d, 900s, 250ms';

const envSchema = z
  .object({
    // Runtime
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),

    // Database
    MONGODB_URI: z
      .string()
      .regex(/^mongodb(\+srv)?:\/\//, 'must be a mongodb:// or mongodb+srv:// connection string'),

    // Auth secrets (SEC-01: ≥ 256-bit, per-environment)
    JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters (≥ 256-bit, SEC-01)'),
    JWT_REFRESH_SECRET: z.string().min(32, 'must be at least 32 characters (≥ 256-bit, SEC-01)'),
    ACCESS_TOKEN_TTL: z.string().regex(DURATION_PATTERN, DURATION_MESSAGE).default('15m'),
    REFRESH_TOKEN_TTL: z.string().regex(DURATION_PATTERN, DURATION_MESSAGE).default('7d'),

    // Google sign-in (AAD) — the OAuth 2.0 Web client id (…apps.googleusercontent.com).
    // Public by nature, not a secret. Absent ⇒ POST /auth/google returns
    // "not available"; email/password auth is unaffected.
    GOOGLE_CLIENT_ID: z.string().optional(),

    // HTTP
    CORS_ORIGIN: z.url({ error: 'must be the exact frontend origin URL (DEP §8)' }),
    TRUST_PROXY_HOPS: z.coerce
      .number()
      .int()
      .min(0, 'must be the exact platform proxy hop count (ARB-01)')
      .default(0),

    // Cloudinary (SEC-08)
    CLOUDINARY_CLOUD_NAME: z.string().min(1),
    CLOUDINARY_API_KEY: z.string().min(1),
    CLOUDINARY_API_SECRET: z.string().min(1),
    // Delivery host pinned into image-URL validation (VAL Issue 4). Matches the
    // helmet CSP img-src + the client CSP; default is Cloudinary's shared host.
    CLOUDINARY_DELIVERY_HOST: z.string().min(1).default('res.cloudinary.com'),

    // Seed bootstrap (FR-USER-06; consumed by task 0.7's seed module)
    SEED_ADMIN_EMAIL: z.email(),
    SEED_ADMIN_PASSWORD: z.string().min(8, 'must be at least 8 characters'),

    // Rate limiting (SEC-04 — defaults per BEA: global 300/15 min, strict 10/15 min)
    RATE_LIMIT_GLOBAL_MAX: z.coerce.number().int().positive().default(300),
    RATE_LIMIT_GLOBAL_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
    RATE_LIMIT_STRICT_MAX: z.coerce.number().int().positive().default(10),
    RATE_LIMIT_STRICT_WINDOW_MS: z.coerce.number().int().positive().default(900_000),

    // Search (D-1 / R-6): Atlas Search on the deployed tier (staging/prod).
    // Absent/false ⇒ the anchored-regex fallback (dev/CI, and any tier without it).
    ATLAS_SEARCH_ENABLED: z
      .preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
      .default(false),

    // AI Inventory Assistant — ships DARK. CHAT_ENABLED gates the route AND the
    // `chatEnabled` flag on the session payload, so the client hides the entry
    // point too. Off ⇒ every LLM_* value below is irrelevant (see the refines).
    CHAT_ENABLED: z
      .preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
      .default(false),
    LLM_PROVIDER: z.enum(LLM_PROVIDERS).default('fake'),
    /** Absent ⇒ the selected provider's default model (providers/index.ts). */
    LLM_MODEL: z.string().min(1).optional(),
    /** Secret (SEC-10). Never VITE_-prefixed — this value never reaches a browser. */
    LLM_API_KEY: z.string().min(1).optional(),
    /**
     * Second provider, used ONLY when the primary reports exhaustion (quota
     * spent, credit gone, key rejected) — not on timeouts or 5xx, which are
     * transient and would burn the backup for nothing. Needs its own key: the
     * whole point is a different account.
     */
    LLM_FALLBACK_PROVIDER: z.enum(LLM_PROVIDERS).optional(),
    LLM_FALLBACK_API_KEY: z.string().min(1).optional(),
    LLM_FALLBACK_MODEL: z.string().min(1).optional(),
    LLM_MAX_TOKENS: z.coerce.number().int().min(16).max(4096).default(256),
    LLM_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(8_000),
    /** Tighter than the global 300/15min, and keyed on the USER (see routes/chat.ts). */
    RATE_LIMIT_CHAT_MAX: z.coerce.number().int().positive().default(30),
    RATE_LIMIT_CHAT_WINDOW_MS: z.coerce.number().int().positive().default(900_000),

    // Observability
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    SENTRY_DSN: z.url().optional(),
  })
  .refine((e) => e.JWT_ACCESS_SECRET !== e.JWT_REFRESH_SECRET, {
    message: 'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ (SEC-01)',
    path: ['JWT_REFRESH_SECRET'],
  })
  // Both chat refines are conditioned on CHAT_ENABLED so "ship dark" actually
  // works: production boots with the feature off and no LLM configuration at
  // all, and only the flip to `true` demands a real provider.
  .refine(
    (e) =>
      !e.CHAT_ENABLED ||
      e.LLM_PROVIDER !== 'fake' ||
      (e.NODE_ENV !== 'production' && e.NODE_ENV !== 'staging'),
    {
      message:
        'must be a real provider when CHAT_ENABLED=true outside development/test — the fake provider answers nothing',
      path: ['LLM_PROVIDER'],
    },
  )
  .refine((e) => !e.CHAT_ENABLED || e.LLM_PROVIDER === 'fake' || Boolean(e.LLM_API_KEY), {
    message: 'is required when CHAT_ENABLED=true with a real LLM_PROVIDER',
    path: ['LLM_API_KEY'],
  })
  // A fallback sharing the primary's account is not a fallback — the failure it
  // exists to survive is that account being spent.
  .refine(
    (e) =>
      e.LLM_FALLBACK_PROVIDER === undefined ||
      e.LLM_FALLBACK_PROVIDER === 'fake' ||
      Boolean(e.LLM_FALLBACK_API_KEY),
    {
      message:
        'is required when LLM_FALLBACK_PROVIDER names a real provider (it needs its OWN key)',
      path: ['LLM_FALLBACK_API_KEY'],
    },
  )
  .refine(
    (e) => e.LLM_FALLBACK_PROVIDER === undefined || e.LLM_FALLBACK_PROVIDER !== e.LLM_PROVIDER,
    {
      message: 'must differ from LLM_PROVIDER — failing over to the same provider changes nothing',
      path: ['LLM_FALLBACK_PROVIDER'],
    },
  );

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvValidationError';
  }
}

/**
 * Validate an environment source (defaults to `process.env`).
 * Blank values are treated as absent — an empty string in a platform secret
 * manager is a misconfiguration, not a value.
 *
 * @throws EnvValidationError naming every offending variable, values withheld.
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const present = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value.trim() !== ''),
  );

  const result = envSchema.safeParse(present);
  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  - ${issue.path.join('.') || '(env)'}: ${issue.message}`,
    );
    throw new EnvValidationError(
      `Invalid environment configuration — refusing to start (NFR-28):\n${lines.join('\n')}\n` +
        'See server/.env.example for the variable inventory.',
    );
  }
  return result.data;
}

let cached: Env | undefined;

/** Lazy singleton — the boot sequence (task 0.10) calls this first. */
export function env(): Env {
  cached ??= loadEnv();
  return cached;
}
