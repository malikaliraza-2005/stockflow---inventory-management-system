/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API origin for this environment (SRS §18.4) — public by definition (SEC §7). */
  readonly VITE_API_BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
