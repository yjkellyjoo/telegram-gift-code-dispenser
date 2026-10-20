import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

const BULK_PATTERN = {
  group: ['**/store/bulk', '**/store/bulk.js', './bulk', './bulk.js'],
  message: 'store/bulk reads every key at once; only src/cli may import it.',
};

const TEST_FILES = ['src/test/**', 'src/**/*.test.ts'];

export default defineConfig(
  { ignores: ['dist/**'] },
  tseslint.configs.recommended,
  {
    // Only src/cli may import store/bulk (tests may too).
    files: ['src/**/*.ts'],
    ignores: ['src/cli/**', ...TEST_FILES],
    rules: {
      'no-restricted-imports': ['error', { patterns: [BULK_PATTERN] }],
    },
  },
  {
    // A later config's options replace an earlier one's for the same rule, so this one repeats the bulk pattern.
    files: ['src/bot/**/*.ts', 'src/core/**/*.ts', 'src/store/**/*.ts', 'src/chain/**/*.ts', 'src/codes/**/*.ts'],
    ignores: TEST_FILES,
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          BULK_PATTERN,
          {
            group: ['**/cli/**'],
            message: 'only the entry point (src/main.ts) may import the CLI.',
          },
        ],
      }],
    },
  },
);
