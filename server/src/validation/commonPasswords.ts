/**
 * BR-32 common-password deny-list (VAL §2 `password` primitive).
 *
 * Curated from the top entries of public breach-corpus lists (rockyou /
 * SecLists top-10k), filtered to entries that would otherwise PASS the format
 * rules (10–64 chars, ≥ 1 letter, ≥ 1 digit) — shorter or all-digit entries
 * are already rejected by the bounds, so listing them would be dead weight.
 * Comparison is case-insensitive (see primitives.ts).
 *
 * MIRROR: client/src/lib/validation/commonPasswords.ts — one entry changed =
 * both files change (VAL §11).
 */
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  'password123',
  'password1234',
  'password12345',
  'password2024',
  'password2025',
  'password2026',
  'qwerty123456',
  'qwertyuiop1',
  'qwerty12345',
  '1qaz2wsx3edc',
  '1q2w3e4r5t6y',
  'q1w2e3r4t5y6',
  'abcd12345678',
  'abc123456789',
  'a123456789',
  'admin123456',
  'administrator1',
  'welcome12345',
  'welcome123',
  'letmein12345',
  'iloveyou123',
  'sunshine123',
  'football1234',
  'baseball1234',
  'superman123',
  'dragon123456',
  'monkey123456',
  'shadow123456',
  'master123456',
  'freedom12345',
  'whatever1234',
  'trustno1trustno1',
  'passw0rd1234',
  'p@ssword1234',
  'secret123456',
  'changeme1234',
  'temp12345678',
  'test12345678',
  'user12345678',
  'demo12345678',
]);
