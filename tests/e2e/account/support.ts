import { createHmac, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { AxeBuilder } from '@axe-core/playwright';
import { test as base, expect, type Page, type TestInfo } from '@playwright/test';
import { config } from 'dotenv';

// The local stack's settings (.env): demo password, seeded admin, Mailpit.
config({ quiet: true });

export { expect };

/** The 375 px project; the other account project is 1440 px. */
export const isPhone = (testInfo: TestInfo) => testInfo.project.name === 'account-375';

export const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025';
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? '';

/** Seeded accounts (prisma/seeding): all use DEMO_PASSWORD. */
export const ACCOUNTS = {
  demo: 'demo.customer@foodz.example',
  unconfirmed: 'unconfirmed.customer@foodz.example',
  suspended: 'suspended.customer@foodz.example',
  second: 'second.customer@foodz.example',
} as const;

/**
 * Each test is its own network, as two customers on different carrier addresses would be, so the
 * per-network limits (sign-ups, failed sign-ins) of one test never spill into another. Without a
 * proxy in front, the app takes the client address from x-forwarded-for (server/request.ts).
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

/** WCAG 2.2 A/AA checks on the whole page. */
export async function expectAccessible(page: Page) {
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
  await expect(page.locator('header').getByText('1 item in your cart')).toBeAttached({
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
export function adminTotpSecret(): string | null {
  const file = process.env.E2E_SEED_OUTPUT;
  if (!file || !existsSync(file)) return null;
  return (
    /otpauth:\/\/totp\/[^\s]*[?&]secret=([A-Z2-7]+)/i.exec(readFileSync(file, 'utf8'))?.[1] ?? null
  );
}

export const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@foodz.example';
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
