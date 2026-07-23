/**
 * FEV-03 / NFR-28 — client config validation (task 0.4).
 * Contract: the config module names the offending variable and fails loudly;
 * components never read import.meta.env directly (getConfig is the only door).
 */
import { loadClientConfig } from '../../src/config';

describe('loadClientConfig (FEV-03 fail-fast)', () => {
  it('parses a valid environment', () => {
    const config = loadClientConfig({ VITE_API_BASE_URL: 'https://api.example.com' });
    expect(config.apiBaseUrl).toBe('https://api.example.com');
  });

  it('names a missing VITE_API_BASE_URL', () => {
    expect(() => loadClientConfig({})).toThrowError(/VITE_API_BASE_URL/);
  });

  it('rejects a malformed URL by name', () => {
    expect(() => loadClientConfig({ VITE_API_BASE_URL: 'not-a-url' })).toThrowError(
      /VITE_API_BASE_URL/,
    );
  });

  it('points the developer at .env.example', () => {
    expect(() => loadClientConfig({})).toThrowError(/\.env\.example/);
  });
});
