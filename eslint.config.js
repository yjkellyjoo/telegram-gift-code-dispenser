import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['dist/**'] },
  tseslint.configs.recommended,
  {
    files: ['src/bot/**/*.ts', 'src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/store/bulk', '**/store/bulk.js'],
          message: 'store/bulk reads every key at once; only src/cli may import it.',
        }],
      }],
    },
  },
);
