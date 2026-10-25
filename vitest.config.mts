import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Server-side unit tests (no database — see test/fake-ctx.ts)
export default defineConfig({
  resolve: {
    alias: {
      '@/': fileURLToPath(new URL('./src/', import.meta.url)),
      // the real package throws outside a react-server build
      'server-only': fileURLToPath(new URL('./test/empty.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    env: { AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-long' },
  },
});
