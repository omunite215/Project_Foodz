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
    // The storefront at the design's phone and desktop widths.
    {
      name: 'storefront-375',
      testMatch: /storefront\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'storefront-1440',
      testMatch: /storefront\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  // Tests run against a production build, the same thing users get.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npx next start --port ${port}`,
        url: baseURL,
        // Always start a fresh production server: reusing whatever already listens on the port
        // (a forgotten `next dev`, say) would test different code from what is being pushed.
        // To test a server that is already running, set E2E_BASE_URL instead.
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          BETTER_AUTH_URL: baseURL,
          NEXT_PUBLIC_SITE_URL: baseURL,
          NEXT_TELEMETRY_DISABLED: '1',
        },
      },
});
