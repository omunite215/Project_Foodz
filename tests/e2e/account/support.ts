import { createHmac, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { AxeBuilder } from '@axe-core/playwright';
import { type Browser, test as base, expect, type Page, type TestInfo } from '@playwright/test';
import { config } from 'dotenv';
import { settleBeforeScan } from '../settle';

// The local stack's settings (.env): demo password, seeded admin, Mailpit.
config({ quiet: true });

export { expect };

/** The 375 px project; the other account project is 1440 px. */
export const isPhone = (testInfo: TestInfo) => testInfo.project.name === 'account-375';

export const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025';
/** The shared password of the demo accounts (demo.*@foodz.example). */
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? '';

/**
 * The seed's output, which CI saves to a file and names in E2E_SEED_OUTPUT (locally, point it at
 * your own copy; appending each run's output to one file keeps every value findable). The last
 * match wins, since some values change on every run.
 */
function fromSeedOutput(pattern: RegExp): string | null {
  const file = process.env.E2E_SEED_OUTPUT;
  if (!file || !existsSync(file)) return null;
  const matches = [...readFileSync(file, 'utf8').matchAll(pattern)];
  return matches.at(-1)?.[1] ?? null;
}

/**
 * The sample customers' password (unconfirmed, suspended and second): random on every seed run
 * and printed by the seed. A local database seeded before they had their own password still
 * uses DEMO_PASSWORD until it is seeded again.
 */
export const SAMPLE_PASSWORD =
  fromSeedOutput(/^Sample customers password[^:]*: (\S+)/gm) ??
  (process.env.CI ? '' : DEMO_PASSWORD);

/** Seeded accounts (prisma/seeding): the demo customer uses DEMO_PASSWORD, the others SAMPLE_PASSWORD. */
export const ACCOUNTS = {
  demo: 'demo.customer@foodz.example',
  unconfirmed: 'unconfirmed.customer@foodz.example',
  suspended: 'suspended.customer@foodz.example',
  second: 'second.customer@foodz.example',
} as const;

/**
 * Each test is its own network, as two customers on different carrier addresses would be, so the
 * per-network limits (sign-ups, failed sign-ins) of one test never spill into another. The test
 * server runs with CLIENT_IP_FROM_HEADER=1 (playwright.config.ts), so it takes the address from
 * x-forwarded-for (server/client-ip.ts).
 * Only requests to the app carry it; third parties (Turnstile, map tiles) see nothing extra.
 */
export const test = base.extend<{ clientIp: string }>({
  clientIp: [
    async ({ context, baseURL }, use) => {
      const ip = `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
      await context.route(`${baseURL}/**`, (route) =>
        route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': ip } }),
      );
      await use(ip);
    },
    { auto: true },
  ],
});

/** A password nobody has used before, so the breach check never refuses it. */
export const newPassword = () => `Foodz ${randomUUID().slice(0, 18)}`;

export const uniqueEmail = (tag: string) => `${tag}-${randomUUID().slice(0, 12)}@example.com`;

/** Opens a page and waits until it is interactive. */
export async function open(page: Page, path: string) {
  const response = await page.goto(path);
  await page.waitForLoadState('networkidle');
  // Set by the root providers once the page has hydrated (a busy machine can lag behind network quiet).
  await page.locator('html[data-hydrated]').waitFor({ state: 'attached', timeout: 20_000 });
  return response;
}

/** Creates an account through the form; the browser is signed in afterwards (U1). */
export async function signUp(
  page: Page,
  {
    name = 'Maya Lopez',
    email = uniqueEmail('maya'),
    password = newPassword(),
    from = '/sign-up',
  } = {},
) {
  await open(page, from);
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('button', { name: /^Account menu for / })).toBeVisible({
    timeout: 30_000,
  });
  return { name, email, password };
}

/** Signs in through the form and waits for the signed-in header. */
export async function signIn(page: Page, email: string, password: string, path = '/sign-in') {
  await open(page, path);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: /^Account menu for / })).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * The same account, signed in on a second device, signs this device out from its devices list
 * (S5.7). This browser keeps its cookie, but the session behind it is gone.
 */
export async function endSessionElsewhere(
  browser: Browser,
  account: { email: string; password: string },
) {
  const other = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
  });
  const second = await other.newPage();
  await signIn(second, account.email, account.password);
  await open(second, '/account/security');
  const devices = second.getByRole('region', { name: 'Signed-in devices' });
  await expect(devices.getByText('This device')).toBeVisible();
  const signOutOther = devices.getByRole('listitem').getByRole('button', { name: /^Sign out / });
  await expect(signOutOther).toHaveCount(1);
  await signOutOther.click();
  await expect(devices.getByText('No other devices are signed in.')).toBeVisible();
  await other.close();
}

/** Signs out from the header's account menu (the cart is empty, so no dialog asks first). */
export async function signOutFromHeader(page: Page) {
  await page.getByRole('button', { name: /^Account menu for / }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.locator('header').getByRole('link', { name: 'Sign in' })).toBeVisible({
    timeout: 15_000,
  });
}

/** The form drafts this tab keeps in sessionStorage (S2.12). */
export const savedDrafts = (page: Page) =>
  page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith('foodz.draft:')));

/** The email carried between the sign-in forms (design 3.8). */
const EMAIL_HANDOFF_KEY = 'foodz.auth.email';

export const carriedEmail = (page: Page) =>
  page.evaluate((key) => sessionStorage.getItem(key), EMAIL_HANDOFF_KEY);

/** Puts an email in the hand-off, as a sign-in form would. */
export const carryEmail = (page: Page, email: string) =>
  page.evaluate(([key, value]) => sessionStorage.setItem(key!, value!), [EMAIL_HANDOFF_KEY, email]);

export const SESSION_ENDED = "You've been signed out. Sign in again to save your changes.";

/** WCAG 2.2 A/AA checks on the whole page. */
export async function expectAccessible(page: Page) {
  await settleBeforeScan(page);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const summary = results.violations.map(
    (violation) =>
      `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
  );
  expect(summary).toEqual([]);
}

/** Nothing wider than the screen. */
export async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** The site's one polite live region. */
export const liveRegion = (page: Page) =>
  page.locator('output[aria-live="polite"][aria-atomic="true"]');

/**
 * Starts writing down what the live region says, from now until the next full page load (client
 * navigations keep it). The announcer clears itself 7 s after speaking, so on a slow machine a
 * check made after a navigation can miss words that were said; `expectHeard` can't.
 */
export async function listenToLiveRegion(page: Page) {
  await page.evaluate(() => {
    const heard: string[] = [];
    Object.assign(window, { foodzHeard: heard });
    new MutationObserver(() => {
      const text = document
        .querySelector('output[aria-live="polite"][aria-atomic="true"]')
        ?.textContent?.trim();
      if (text && heard.at(-1) !== text) heard.push(text);
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
}

/**
 * Passes once the live region has said `text` since `listenToLiveRegion`. The announcer gathers
 * messages that arrive close together into one, so `text` may be part of a longer announcement.
 */
export async function expectHeard(page: Page, text: string) {
  await expect
    .poll(async () => {
      const heard = await page.evaluate(
        () => (window as { foodzHeard?: string[] }).foodzHeard ?? [],
      );
      return heard.some((said) => said.includes(text));
    })
    .toBe(true);
}

/** Collects console errors (CSP refusals included) while the test runs. */
export function watchConsole(page: Page) {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  return problems;
}

/** Puts one dish in the cart through the dish page, as a customer would. */
export async function addDishToCart(page: Page) {
  await open(page, '/menu/yangnyeom-chicken');
  await page
    .locator('main')
    .getByRole('button', { name: /^Add to cart/ })
    .click();
  await expect(page.locator('header').getByRole('button', { name: 'Cart, 1 item' })).toBeVisible({
    timeout: 10_000,
  });
}

export async function savedCartCount(page: Page): Promise<number> {
  const raw = await page.evaluate(() => localStorage.getItem('foodz.cart.v1'));
  if (!raw) return 0;
  const saved: Record<string, { data: { quantity: number } }> = JSON.parse(raw);
  return Object.values(saved).reduce((total, entry) => total + entry.data.quantity, 0);
}

// ------------------------------------------------------------------ email (Mailpit)

interface MailSummary {
  ID: string;
  Subject: string;
  Created: string;
}

/** The newest email to `to` with `subject`, waiting for the job queue to deliver it. */
export async function latestEmail(to: string, subject: string, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}" subject:"${subject}"`)}`,
    );
    const { messages } = (await response.json()) as { messages: MailSummary[] };
    const newest = messages.toSorted((a, b) => b.Created.localeCompare(a.Created))[0];
    if (newest) {
      const message = (await (await fetch(`${MAILPIT}/api/v1/message/${newest.ID}`)).json()) as {
        Text: string;
      };
      return message.Text;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No "${subject}" email for ${to}`);
}

/** The link in an account email (the plain-text part carries it on its own line). */
export function linkIn(text: string, path: string) {
  const match = new RegExp(`https?://[^\\s]+${path.replaceAll('/', '\\/')}[^\\s]*`).exec(text);
  if (!match) throw new Error(`No ${path} link in the email`);
  return match[0];
}

// ------------------------------------------------------------------ the seeded admin (two-factor)

/**
 * The seeded admin's authenticator secret, from the seed's one-time output. CI saves that output
 * to a file and names it in E2E_SEED_OUTPUT; locally, point it at your own copy.
 */
export const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@foodz.example';

/**
 * The admin's own authenticator line: the seed also prints the sample staff's authenticators
 * (F5), so the admin's is found by its email, never by being the last one in the file. The
 * admin's is printed only by the first seed of a database; without it this returns null.
 */
export function adminTotpSecret(): string | null {
  const file = process.env.E2E_SEED_OUTPUT;
  if (!file || !existsSync(file)) return null;
  const email = ADMIN_EMAIL.toLowerCase();
  const uris = readFileSync(file, 'utf8').match(/otpauth:\/\/totp\/\S+/gi) ?? [];
  const admin = uris.findLast((uri) => {
    const lower = uri.toLowerCase();
    return lower.includes(encodeURIComponent(email)) || lower.includes(email);
  });
  return admin ? new URL(admin).searchParams.get('secret') : null;
}

export const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? '';

function base32(secret: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of secret.toUpperCase().replace(/=+$/, '')) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
  }
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((byte) => Number.parseInt(byte, 2)));
}

/** RFC 6238 code (SHA-1, 30 s, 6 digits), as an authenticator app shows it. */
export function totp(secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hmac = createHmac('sha1', base32(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const value = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(value).padStart(6, '0');
}

/** A code with at least 5 seconds left in its window. */
export async function freshTotp(secret: string) {
  const left = 30_000 - (Date.now() % 30_000);
  if (left < 5_000) await new Promise((resolve) => setTimeout(resolve, left + 200));
  return totp(secret);
}
