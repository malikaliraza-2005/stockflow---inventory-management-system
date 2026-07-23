import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // first integration run downloads the MongoDB binary — generous hook budget
    hookTimeout: 120_000,
  },
});
