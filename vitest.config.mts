import path from 'node:path';
import { defineConfig } from 'vitest/config';

const root = import.meta.dirname;

const resolve = {
  alias: {
    '@': root,
    // `server-only` throws outside React Server Components; tests run server code directly.
    'server-only': path.join(root, 'tests/support/server-only.ts'),
  },
};

export default defineConfig({
  resolve,
  test: {
    coverage: {
      provider: 'v8',
      include: ['server/**/*.ts', 'lib/**/*.ts'],
      exclude: ['server/db/generated/**', '**/*.test.ts'],
      reporter: ['text-summary', 'html', 'json-summary'],
    },
    projects: [
      {
        resolve,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['server/**/*.test.ts', 'lib/**/*.test.ts', 'tests/unit/**/*.test.ts'],
        },
      },
      {
        resolve,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          globalSetup: ['tests/integration/global-setup.ts'],
          setupFiles: ['tests/integration/setup-env.ts'],
          // Better Auth loads `next/headers.js` itself to set cookies from Server Actions; running
          // it through Vite lets the tests' stand-in for the browser receive those cookies.
          server: { deps: { inline: ['better-auth'] } },
          testTimeout: 30_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
