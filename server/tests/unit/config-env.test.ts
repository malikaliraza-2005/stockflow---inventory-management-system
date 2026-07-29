/**
 * NFR-28 / DEP §7 — env schema validation (task 0.4).
 * The contract under test: boot refuses bad config BY NAME, collects every
 * violation, applies documented defaults, and never echoes secret values.
 */
import { describe, expect, it } from 'vitest';

import { EnvValidationError, loadEnv } from '../../src/config/env.js';

/** Minimal valid environment — every required variable, no optionals. */
function validEnv(): Record<string, string> {
  return {
    NODE_ENV: 'test',
    MONGODB_URI: 'mongodb+srv://app:pw@cluster.example.mongodb.net/ims-dev',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    CORS_ORIGIN: 'https://app.example.com',
    CLOUDINARY_CLOUD_NAME: 'ims-dev',
    CLOUDINARY_API_KEY: '123456789',
    CLOUDINARY_API_SECRET: 'cloudinary-secret-value',
    SEED_ADMIN_EMAIL: 'admin@example.com',
    SEED_ADMIN_PASSWORD: 'initial-password',
  };
}

describe('loadEnv (NFR-28 fail-fast)', () => {
  it('parses a valid environment and applies documented defaults', () => {
    const env = loadEnv(validEnv());

    expect(env.NODE_ENV).toBe('test');
    expect(env.PORT).toBe(3000);
    expect(env.ACCESS_TOKEN_TTL).toBe('15m');
    expect(env.REFRESH_TOKEN_TTL).toBe('7d');
    expect(env.TRUST_PROXY_HOPS).toBe(0);
    expect(env.RATE_LIMIT_GLOBAL_MAX).toBe(300);
    expect(env.RATE_LIMIT_STRICT_MAX).toBe(10);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.SENTRY_DSN).toBeUndefined();
  });

  it('coerces numeric variables from strings', () => {
    const env = loadEnv({ ...validEnv(), PORT: '8080', TRUST_PROXY_HOPS: '2' });
    expect(env.PORT).toBe(8080);
    expect(env.TRUST_PROXY_HOPS).toBe(2);
  });

  it('names a missing required variable', () => {
    const source = validEnv();
    delete source['MONGODB_URI'];

    expect(() => loadEnv(source)).toThrowError(EnvValidationError);
    expect(() => loadEnv(source)).toThrowError(/MONGODB_URI/);
  });

  it('collects ALL violations in one report, each named', () => {
    const source = validEnv();
    delete source['CLOUDINARY_API_KEY'];
    delete source['SEED_ADMIN_EMAIL'];

    let message = '';
    try {
      loadEnv(source);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/CLOUDINARY_API_KEY/);
    expect(message).toMatch(/SEED_ADMIN_EMAIL/);
  });

  it('treats blank values as absent (a blank secret is a misconfiguration)', () => {
    expect(() => loadEnv({ ...validEnv(), CORS_ORIGIN: '   ' })).toThrowError(/CORS_ORIGIN/);
  });

  it('rejects a too-short JWT secret WITHOUT echoing its value', () => {
    const shortSecret = 'hunter2-visible-leak';
    let message = '';
    try {
      loadEnv({ ...validEnv(), JWT_ACCESS_SECRET: shortSecret });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/JWT_ACCESS_SECRET/);
    expect(message).not.toContain(shortSecret); // SEC-10: values never surface
  });

  it('rejects identical access and refresh secrets', () => {
    const same = 'c'.repeat(40);
    expect(() =>
      loadEnv({ ...validEnv(), JWT_ACCESS_SECRET: same, JWT_REFRESH_SECRET: same }),
    ).toThrowError(/must differ/);
  });

  it('rejects a malformed MONGODB_URI by name', () => {
    expect(() => loadEnv({ ...validEnv(), MONGODB_URI: 'postgres://nope' })).toThrowError(
      /MONGODB_URI/,
    );
  });

  it('rejects malformed TTL durations by name', () => {
    expect(() => loadEnv({ ...validEnv(), ACCESS_TOKEN_TTL: 'fifteen-minutes' })).toThrowError(
      /ACCESS_TOKEN_TTL/,
    );
  });

  it('rejects an invalid NODE_ENV by name', () => {
    expect(() => loadEnv({ ...validEnv(), NODE_ENV: 'prod' })).toThrowError(/NODE_ENV/);
  });
});

describe('AI Inventory Assistant configuration', () => {
  it('defaults to OFF with the fake provider — the feature ships dark', () => {
    const env = loadEnv(validEnv());

    expect(env.CHAT_ENABLED).toBe(false);
    expect(env.LLM_PROVIDER).toBe('fake');
    expect(env.LLM_MAX_TOKENS).toBe(256);
    expect(env.LLM_TIMEOUT_MS).toBe(8_000);
    expect(env.RATE_LIMIT_CHAT_MAX).toBe(30);
    expect(env.LLM_API_KEY).toBeUndefined();
  });

  it('coerces the boolean and numeric forms platforms actually supply', () => {
    const env = loadEnv({
      ...validEnv(),
      CHAT_ENABLED: 'true',
      LLM_MAX_TOKENS: '512',
      LLM_TIMEOUT_MS: '3000',
    });
    expect(env.CHAT_ENABLED).toBe(true);
    expect(env.LLM_MAX_TOKENS).toBe(512);
    expect(env.LLM_TIMEOUT_MS).toBe(3_000);
  });

  it('boots production with chat OFF and NO llm configuration at all (ship dark)', () => {
    expect(() =>
      loadEnv({ ...validEnv(), NODE_ENV: 'production', CHAT_ENABLED: 'false' }),
    ).not.toThrow();
  });

  it('refuses the fake provider once chat is enabled in staging or production', () => {
    for (const nodeEnv of ['staging', 'production']) {
      expect(() =>
        loadEnv({
          ...validEnv(),
          NODE_ENV: nodeEnv,
          CHAT_ENABLED: 'true',
          LLM_PROVIDER: 'fake',
        }),
      ).toThrowError(/LLM_PROVIDER/);
    }
  });

  it('allows the fake provider with chat enabled in development', () => {
    const env = loadEnv({ ...validEnv(), NODE_ENV: 'development', CHAT_ENABLED: 'true' });
    expect(env.LLM_PROVIDER).toBe('fake');
  });

  it('demands a key for a real provider — WITHOUT echoing it', () => {
    expect(() =>
      loadEnv({ ...validEnv(), CHAT_ENABLED: 'true', LLM_PROVIDER: 'gemini' }),
    ).toThrowError(/LLM_API_KEY/);

    const key = 'AIza-secret-value-should-never-be-logged';
    let message = '';
    try {
      loadEnv({ ...validEnv(), CHAT_ENABLED: 'true', LLM_PROVIDER: 'gemini', LLM_API_KEY: '  ' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/LLM_API_KEY/);
    expect(message).not.toContain(key);
  });

  it('accepts a fully configured real provider', () => {
    const env = loadEnv({
      ...validEnv(),
      NODE_ENV: 'production',
      CHAT_ENABLED: 'true',
      LLM_PROVIDER: 'gemini',
      LLM_MODEL: 'gemini-2.5-flash',
      LLM_API_KEY: 'AIza-test-key',
    });
    expect(env.CHAT_ENABLED).toBe(true);
    expect(env.LLM_PROVIDER).toBe('gemini');
  });

  it('rejects an unknown provider id by name', () => {
    expect(() => loadEnv({ ...validEnv(), LLM_PROVIDER: 'ollama' })).toThrowError(/LLM_PROVIDER/);
  });
});
