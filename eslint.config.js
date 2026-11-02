import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['.output/**', '.wxt/**', 'coverage/**', 'dist/**', 'node_modules/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // WXT injects these as auto-imports in entrypoints.
    files: ['entrypoints/**/*.ts'],
    languageOptions: {
      globals: { defineBackground: 'readonly', browser: 'readonly' },
    },
  },
);
