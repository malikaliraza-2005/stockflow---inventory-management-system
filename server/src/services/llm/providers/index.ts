/**
 * Provider selection — deliberately a `switch`, not a registry.
 *
 * A registry module (map of id → factory, dynamic import, plugin discovery) is
 * the shape you build when providers arrive from outside the codebase. Here
 * there are two, both in this folder, and adding a third is one more arm.
 */
import { makeStubProvider } from './fake.js';
import { makeGeminiProvider } from './gemini.js';
import type { LlmProvider } from '../types.js';

export interface LlmConfig {
  LLM_PROVIDER: 'fake' | 'gemini';
  LLM_MODEL: string;
  LLM_API_KEY?: string | undefined;
}

export function createLlmProvider(config: LlmConfig): LlmProvider {
  switch (config.LLM_PROVIDER) {
    case 'gemini':
      return makeGeminiProvider({
        apiKey: config.LLM_API_KEY ?? '',
        model: config.LLM_MODEL,
      });
    case 'fake':
      // Dev/test default. Answers `unsupported` to everything, which is a
      // truthful "not configured" rather than a plausible fabrication.
      return makeStubProvider();
  }
}
