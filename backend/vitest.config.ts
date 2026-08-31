import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['node_modules', 'dist', 'scratch', '.idea', '.git', '.cache'],
    include: ['src/**/*.spec.ts', 'test/**/*.test.ts'],
    fileParallelism: false
  },
});
