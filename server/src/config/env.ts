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

    // Seed bootstrap (FR-USER-06; consumed by task 0.7's seed module)
    SEED_ADMIN_EMAIL: z.email(),
    SEED_ADMIN_PASSWORD: z.string().min(8, 'must be at least 8 characters'),

    // Rate limiting (SEC-04 — defaults per BEA: global 300/15 min, strict 10/15 min)
    RATE_LIMIT_GLOBAL_MAX: z.coerce.number().int().positive().default(300),
    RATE_LIMIT_GLOBAL_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
    RATE_LIMIT_STRICT_MAX: z.coerce.number().int().positive().default(10),
    RATE_LIMIT_STRICT_WINDOW_MS: z.coerce.number().int().positive().default(900_000),

    // Observability
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    SENTRY_DSN: z.url().optional(),
  })
  .refine((e) => e.JWT_ACCESS_SECRET !== e.JWT_REFRESH_SECRET, {
    message: 'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ (SEC-01)',
    path: ['JWT_REFRESH_SECRET'],
  });

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
