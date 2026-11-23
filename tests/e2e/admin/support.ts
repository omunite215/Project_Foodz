import { createHmac } from 'node:crypto';
import { createOTP } from '@better-auth/utils/otp';
import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Page, type TestInfo } from '@playwright/test';
import { ACCOUNTS, DEMO_PASSWORD, open, SAMPLE_PASSWORD, test } from '../account/support';

/*
 * Staff for the F5 suites (tests/e2e/admin). They use the seeded sample staff and the board's
 * fixtures S1101 to S1108: run the seed, then `npm run seed:board` before each session (the
 * timers age). The admin projects run only with E2E_ADMIN=1 (playwright.config.ts).
 */

export { ACCOUNTS, DEMO_PASSWORD, expect, open, SAMPLE_PASSWORD, test };

export const STAFF = {
  kitchen: 'kitchen@foodz.example',
  support: 'support@foodz.example',
  editor: 'editor@foodz.example',
  noFactor: 'kitchen.nofactor@foodz.example',
  demoAdmin: 'demo.admin@foodz.example',
} as const;

export const isPhone = (testInfo: TestInfo) => testInfo.project.name === 'admin-375';
export const isTablet = (testInfo: TestInfo) => testInfo.project.name === 'admin-1024';

/** The seed's sample staff authenticator: derived from BETTER_AUTH_SECRET and the email. */
function totpSecret(email: string) {
  const secret = process.env.BETTER_AUTH_SECRET ?? '';
  return createHmac('sha256', secret)
    .update(`foodz-staff-totp:${email}`)
    .digest('hex')
    .slice(0, 32);
}

export const codeFor = (email: string) => createOTP(totpSecret(email), { digits: 6 }).totp();

/**
 * Signs a staff member in: password, then the authenticator code (no "Don't ask again" for
 * staff). Lands on `path`, or /admin, which sends staff to their screen.
 */
export async function signInStaff(page: Page, email: string, path = '/admin') {
  await open(page, `/sign-in?callbackUrl=${encodeURIComponent(path)}`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(SAMPLE_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  const code = page.getByLabel('6-digit code');
  const twoFactor = await code
    .waitFor({ timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (twoFactor) {
    await code.fill(await codeFor(email));
    await page.getByRole('button', { name: 'Continue' }).click();
  }
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 30_000 });
  // Interactive: the page's scripts have taken over the server's HTML.
  await page.waitForLoadState('networkidle');
}

/** The demo admin signs in without a code (F2) with the shared demo password. */
export async function signInDemoAdmin(page: Page, path = '/admin/orders') {
  await open(page, `/sign-in?callbackUrl=${encodeURIComponent(path)}`);
  await page.getByLabel('Email').fill(STAFF.demoAdmin);
  await page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 30_000 });
  // Interactive: the page's scripts have taken over the server's HTML.
  await page.waitForLoadState('networkidle');
}

/** WCAG 2.2 AA on the page as it is now (A16.9). */
export async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
}

/** An order's staff address from its card, also when its column is another phone tab. */
export const orderHrefOnBoard = (page: Page, number: string) =>
  page.locator(`article[data-order="${number}"] h3 a`).getAttribute('href');

/** A card on the board by its order number. */
export const card = (page: Page, number: string) =>
  page.getByRole('article', { name: `Order ${number}` });

/** Opens a column at phone width (status tabs), or does nothing on wider boards. */
export async function showColumn(page: Page, testInfo: TestInfo, tab: RegExp) {
  if (!isPhone(testInfo)) return;
  await page.getByRole('tab', { name: tab }).click();
}
