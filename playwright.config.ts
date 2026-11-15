import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 3456);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'smoke', testMatch: /smoke\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'smoke-mobile',
      testMatch: /smoke\.spec\.ts/,
      use: { ...devices['Pixel 7'] },
    },
  ],
  // Tests run against a production build, the same thing users get.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npx next start --port ${port}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          BETTER_AUTH_URL: baseURL,
          NEXT_PUBLIC_SITE_URL: baseURL,
          NEXT_TELEMETRY_DISABLED: '1',
        },
      },
});
