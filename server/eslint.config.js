import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Plain-node tooling (scripts/*.mjs) runs outside the TS project
  { files: ['scripts/**/*.mjs'], languageOptions: { globals: globals.node } },
  prettier,
);
