import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  // Match Next's automatic JSX runtime so component modules under test
  // don't need React in scope (classic runtime would throw
  // "React is not defined").
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    globals: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
