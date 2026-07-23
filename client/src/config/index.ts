/**
 * Client configuration — FEV-03 / NFR-28.
 *
 * The single place `import.meta.env` is read. Components and the API layer call
 * `getConfig()`; a missing or malformed variable fails loudly at bootstrap
 * (main.tsx renders the error instead of a blank page).
 *
 * VITE_ variables are baked into the bundle at build time — public by
 * definition (SEC §7). Never a secret.
 */
import { z } from 'zod';

const clientEnvSchema = z.object({
  VITE_API_BASE_URL: z.url({
    error: 'must be the API origin URL for this environment, e.g. https://api.example.com',
  }),
});

export interface AppConfig {
  readonly apiBaseUrl: string;
}

/** Validate a raw env source. Exported for tests; app code uses `getConfig()`. */
export function loadClientConfig(source: Record<string, unknown>): AppConfig {
  const result = clientEnvSchema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  - ${issue.path.join('.') || '(env)'}: ${issue.message}`,
    );
    throw new Error(
      `Invalid client configuration (FEV-03 / NFR-28):\n${lines.join('\n')}\n` +
        'Define the variable(s) in client/.env — see client/.env.example.',
    );
  }
  return { apiBaseUrl: result.data.VITE_API_BASE_URL };
}

let cached: AppConfig | undefined;

export function getConfig(): AppConfig {
  cached ??= loadClientConfig(import.meta.env);
  return cached;
}
