import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 3456);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // Locally the default (half the cores) starts so many browsers that a dev machine running the
  // Docker stack runs out of memory. E2E_WORKERS overrides it.
  workers: process.env.CI ? undefined : Number(process.env.E2E_WORKERS ?? 4),
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
    // Sign-in and account pages (F2). They create accounts and wait for emails, so each test
    // gets more time than a storefront page needs.
    {
      name: 'account-375',
      testMatch: /account\/.*\.spec\.ts/,
      timeout: 90_000,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'account-1440',
      testMatch: /account\/.*\.spec\.ts/,
      timeout: 90_000,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    // The partner app (F6) at the design's phone widths and desktop. They need the partner
    // fixtures (`npm run seed:partners` first), so they run only with E2E_PARTNER=1.
    ...(process.env.E2E_PARTNER === '1'
      ? [
          { width: 360, height: 760, name: 'partner-360' },
          { width: 375, height: 812, name: 'partner-375' },
        ]
          .map(({ width, height, name }) => ({
            name,
            testMatch: /e2e\/partner\/.*\.spec\.ts/,
            timeout: 90_000,
            use: {
              ...devices['Desktop Chrome'],
              viewport: { width, height },
              isMobile: true,
              hasTouch: true,
            },
          }))
          .concat([
            {
              name: 'partner-1440',
              testMatch: /e2e\/partner\/.*\.spec\.ts/,
              timeout: 90_000,
              use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
            },
          ])
      : []),
    // The staff tools and the live order (F5). They need the seeded staff and the board's
    // fixtures (`npm run seed:board` first), so they run only with E2E_ADMIN=1.
    ...(process.env.E2E_ADMIN === '1'
      ? [
          {
            name: 'admin-375',
            testMatch: /admin\/.*\.spec\.ts/,
            timeout: 90_000,
            use: {
              ...devices['Desktop Chrome'],
              viewport: { width: 375, height: 812 },
              isMobile: true,
              hasTouch: true,
            },
          },
          {
            name: 'admin-1024',
            testMatch: /admin\/.*\.spec\.ts/,
            timeout: 90_000,
            use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 768 } },
          },
          {
            name: 'admin-1440',
            testMatch: /admin\/.*\.spec\.ts/,
            timeout: 90_000,
            use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
          },
          // Flows that change the fixtures for good (a refusal, then "Order again"): after the
          // projects above, one viewport at a time; each resets the fixtures first.
          {
            name: 'admin-flows-1440',
            testMatch: /admin-flows\/.*\.spec\.ts/,
            dependencies: ['admin-375', 'admin-1024', 'admin-1440'],
            timeout: 120_000,
            use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
          },
          {
            name: 'admin-flows-375',
            testMatch: /admin-flows\/.*\.spec\.ts/,
            dependencies: ['admin-flows-1440'],
            timeout: 120_000,
            use: {
              ...devices['Desktop Chrome'],
              viewport: { width: 375, height: 812 },
              isMobile: true,
              hasTouch: true,
            },
          },
        ]
      : []),
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
          // Test-only: each test sends its own X-Forwarded-For, so per-network limits stay apart
          // (tests/e2e/account/support.ts). A server given through E2E_BASE_URL needs it too.
          CLIENT_IP_FROM_HEADER: '1',
        },
      },
});
