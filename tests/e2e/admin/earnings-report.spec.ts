import { readFileSync } from 'node:fs';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_PASSWORD, adminTotpSecret, freshTotp } from '../account/support';
import {
  expect,
  expectNoAxeViolations,
  isPhone,
  isTablet,
  open,
  SAMPLE_PASSWORD,
  signInDemoAdmin,
  signInStaff,
  STAFF,
  test,
} from './support';

/*
 * The earnings and payouts report (F9 design 3.1, 3.12 to 3.15, A63, A64, A66): the seeded
 * admin reads one store week of the earnings fixtures, changes range, filter and sort in the
 * address, downloads the CSV; SUPPORT and KITCHEN get the no-access page; the demo admin sees
 * real partners masked. Read-only: nothing here writes to the ledger.
 *
 * Needs the sample staff and the earnings fixtures written for a fixed T, so the week's figures
 * never depend on the day the suite runs:
 *   npm run seed:partners && npm run seed:earnings -- --at=2026-11-20T19:46:00-05:00
 * (E2E_EARNINGS_AT names another T; it must be the same value given to `--at`). The seeded
 * admin signs in with SEED_ADMIN_PASSWORD and the authenticator in E2E_SEED_OUTPUT. Runs with
 * E2E_ADMIN=1 at 375, 1024 and 1440 px; the 1440 project also checks 1280.
 */

const T = process.env.E2E_EARNINGS_AT ?? '2026-11-20T19:46:00-05:00';
const ZONE = 'America/New_York';
const DAY_MS = 86_400_000;

const storeDate = (at: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** Monday to Sunday of the store week holding `at` (U8). */
function weekOf(at: Date) {
  const date = storeDate(at);
  const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  const from = addDays(date, -weekday);
  return { from, to: addDays(from, 6) };
}

const short = (date: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(
    new Date(`${date}T12:00:00Z`),
  );

const WEEK = weekOf(new Date(T));
const THIS_WEEK = weekOf(new Date());
const REPORT_URL = `/admin/partners/earnings?from=${WEEK.from}&to=${WEEK.to}`;
const SPOKEN = `${short(WEEK.from)} to ${short(WEEK.to)}`;

/**
 * The fixture week at T (prisma/seeding/earnings.ts): Luis's 17 deliveries, Monday's payout and
 * Thursday's hand-in; Diego's three cash deliveries on Tuesday (A63.4's figures for Diego).
 */
const LUIS = [
  '17',
  '$83.88',
  '$34.50',
  '$0.00',
  '$118.38',
  '$84.95',
  '$84.95',
  '$96.40',
  'Foodz owes $96.40',
  'Foodz owes $118.38',
];
const DIEGO = [
  '3',
  '$18.10',
  '$4.00',
  '$0.00',
  '$22.10',
  '$164.80',
  '$0.00',
  '$0.00',
  '$0.00',
  'Owes $142.70',
];

const CSV_HEADER =
  'Partner ID,Partner,Vehicle,From,To,Deliveries,Delivery pay,Tips,Bonuses and adjustments,Earned,Cash collected,Cash handed in,Paid out,Opening balance,Closing balance';

test.beforeEach(() => {
  test.skip(!SAMPLE_PASSWORD, 'Needs the sample password (E2E_SEED_OUTPUT).');
});

function skipWithoutAdmin() {
  const secret = adminTotpSecret();
  test.skip(
    !secret || !ADMIN_PASSWORD,
    'Needs SEED_ADMIN_PASSWORD and the admin authenticator in E2E_SEED_OUTPUT.',
  );
  return secret ?? '';
}

/** The seeded ADMIN: password, then a fresh authenticator code. */
async function signInAdmin(page: Page, secret: string, path: string) {
  await open(page, `/sign-in?callbackUrl=${encodeURIComponent(path)}`);
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  const code = page.getByLabel('6-digit code');
  await code.waitFor({ timeout: 30_000 });
  await code.fill(await freshTotp(secret));
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 30_000 });
  await page.waitForLoadState('networkidle');
}

/** A partner's table row (1024 and up) by the name in its row header. */
const tableRow = (page: Page, name: string) =>
  page.getByRole('row').filter({ has: page.getByRole('rowheader', { name, exact: true }) });

/** A partner's card (below 1024) by its name link. */
const partnerCard = (page: Page, name: string) =>
  page.getByRole('listitem').filter({ has: page.getByRole('link', { name, exact: true }) });

async function expectFigures(page: Page, testInfo: TestInfo, name: string, figures: string[]) {
  if (isPhone(testInfo)) {
    const card = partnerCard(page, name);
    await expect(card).toBeVisible();
    // Closing balance first (design 3.14), then the rest in the table's order.
    await expect(card.locator('p').first()).toHaveText('Closing balance');
    await expect(card.locator('p').nth(1)).toHaveText(figures[9] ?? '');
    await expect(card.getByRole('definition')).toHaveText(figures.slice(0, 9));
    return;
  }
  const row = tableRow(page, name);
  await expect(row).toBeVisible();
  await expect(row.getByRole('cell')).toHaveText(figures);
}

async function rowIndex(page: Page, name: string): Promise<number> {
  const rows = page.getByRole('row');
  const count = await rows.count();
  for (let index = 0; index < count; index += 1) {
    const header = rows.nth(index).getByRole('rowheader', { name, exact: true });
    if ((await header.count()) > 0) return index;
  }
  return -1;
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

const regionOf = (page: Page): Locator => page.getByRole('region', { name: /^Partner earnings,/ });

test('ADMIN reads the week: summary, rows, totals and the sidebar entry', async ({
  page,
}, testInfo) => {
  const secret = skipWithoutAdmin();
  await signInAdmin(page, secret, REPORT_URL);
  await expect(page).toHaveTitle('Earnings and payouts | Foodz Admin');
  await expect(page.getByRole('heading', { level: 1, name: 'Earnings and payouts' })).toBeVisible();
  await expect(page.getByText(/· Dates and times are Boston time\.$/)).toBeVisible();

  await expect(page.getByRole('term').filter({ hasText: 'Foodz owes partners' })).toBeVisible();
  await expect(page.getByRole('term').filter({ hasText: 'Partners owe Foodz' })).toBeVisible();

  await expectFigures(page, testInfo, 'Luis Moreno', LUIS);
  await expectFigures(page, testInfo, 'Diego Alvarez', DIEGO);
  // The totals never net the balances (conflict 8).
  // Table and cards both exist; only one shows at a width.
  await expect(page.getByText(/^Totals · \d+ partners?$/).filter({ visible: true })).toBeVisible();
  await expect(
    page
      .getByText(/^Owed to Foodz \$/)
      .filter({ visible: true })
      .first(),
  ).toBeVisible();

  if (!isPhone(testInfo)) {
    await expect(regionOf(page)).toBeVisible();
    // Review S6: every header's sort button stays inside its own column.
    const overflows = await page.locator('thead th').evaluateAll((cells) =>
      cells.flatMap((cell) => {
        const button = cell.querySelector('button');
        if (!button) return [];
        const outer = cell.getBoundingClientRect();
        const inner = button.getBoundingClientRect();
        return inner.right > outer.right + 0.5 || inner.left < outer.left - 0.5
          ? [cell.textContent ?? '']
          : [];
      }),
    );
    expect(overflows).toEqual([]);
    await expect(page.getByRole('columnheader', { name: 'Partner' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    // Only the report's entry is current, never Partners (design 3.1).
    const entry = page.getByRole('link', { name: 'Earnings and payouts' });
    await expect(entry).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('link', { name: /^Partners/ })).not.toHaveAttribute(
      'aria-current',
      'page',
    );
  }
  if (isTablet(testInfo)) {
    // 1024: the table scrolls inside its own region; the page never does (D25).
    const region = regionOf(page);
    await expect(region).toHaveAttribute('tabindex', '0');
    const scrolls = await region.evaluate((element) => element.scrollWidth > element.clientWidth);
    expect(scrolls).toBe(true);
  }
  await noSidewaysScroll(page);
  await expectNoAxeViolations(page);

  // A partner's name opens their Earnings on the report's range (design 3.13).
  const link = page.getByRole('link', { name: 'Luis Moreno', exact: true });
  await expect(link).toHaveAttribute(
    'href',
    new RegExp(`\\?view=earnings&from=${WEEK.from}&to=${WEEK.to}$`),
  );
});

test('ADMIN changes range, filter and sort in the address', async ({ page }, testInfo) => {
  const secret = skipWithoutAdmin();
  await signInAdmin(page, secret, REPORT_URL);

  // "Owes Foodz" leaves Diego (A63.5).
  if (isPhone(testInfo)) {
    await page.getByLabel('Show', { exact: true }).selectOption('owes-foodz');
  } else {
    await page
      .getByRole('group', { name: 'Show' })
      .getByRole('link', { name: 'Owes Foodz' })
      .click();
  }
  await expect(page).toHaveURL(/filter=owes-foodz/);
  await expect(
    page.getByRole('link', { name: 'Diego Alvarez', exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Luis Moreno', exact: true })).toHaveCount(0);

  // Search keeps the range and the filter, and finds no one under it.
  await page.getByRole('searchbox', { name: 'Search partners' }).fill('luis');
  await expect(page).toHaveURL(/q=luis/);
  await expect(page.getByRole('heading', { name: 'No matching partners' })).toBeVisible();
  await page.getByRole('link', { name: 'Clear filters' }).click();
  await expect(page).not.toHaveURL(/filter=|q=/);
  await expect(page.getByRole('link', { name: 'Luis Moreno', exact: true }).first()).toBeVisible();

  if (!isPhone(testInfo)) {
    // Every column sorts on the server; money reads largest first, then flips.
    await page.getByRole('button', { name: 'Closing balance' }).click();
    await expect(page).toHaveURL(/sort=closing&dir=desc/);
    const closing = page.getByRole('columnheader', { name: 'Closing balance' });
    await expect(closing).toHaveAttribute('aria-sort', 'descending');
    expect(await rowIndex(page, 'Luis Moreno')).toBeLessThan(await rowIndex(page, 'Diego Alvarez'));
    await page.getByRole('button', { name: 'Closing balance' }).click();
    await expect(page).toHaveURL(/sort=closing&dir=asc/);
    await expect(closing).toHaveAttribute('aria-sort', 'ascending');
    expect(await rowIndex(page, 'Diego Alvarez')).toBeLessThan(await rowIndex(page, 'Luis Moreno'));

    // The custom dates check before they change anything.
    await page.getByRole('button', { name: /^Custom/ }).click();
    await expect(page.getByRole('textbox', { name: 'From', exact: true })).toBeFocused();
    await page.getByRole('textbox', { name: 'From', exact: true }).fill(WEEK.to);
    await page.getByRole('textbox', { name: 'To', exact: true }).fill(WEEK.from);
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText("The end date can't be before the start.")).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'To', exact: true })).toBeFocused();
    await expect(page.getByRole('textbox', { name: 'To', exact: true })).toHaveAttribute(
      'aria-invalid',
      'true',
    );

    await page
      .getByRole('group', { name: 'Range' })
      .getByRole('link', { name: 'This week' })
      .click();
  } else {
    // At 375 the range is one button and a sheet (design 3.14).
    await page.getByRole('button', { name: new RegExp(`${short(WEEK.from)} – `) }).click();
    const sheet = page.getByRole('dialog', { name: 'Date range' });
    await expect(sheet.getByRole('heading', { name: 'Date range' })).toBeFocused();
    await expectNoAxeViolations(page);
    await sheet.getByRole('radio', { name: 'This week' }).check();
    await sheet.getByRole('button', { name: 'Apply' }).click();
    await expect(sheet).toBeHidden();
  }
  await expect(page).toHaveURL(new RegExp(`from=${THIS_WEEK.from}&to=${THIS_WEEK.to}`));
  await noSidewaysScroll(page);
});

test('ADMIN downloads the CSV: every row, no names in the file name, numbers untouched', async ({
  page,
}) => {
  const secret = skipWithoutAdmin();
  await signInAdmin(page, secret, REPORT_URL);
  const button = page.getByRole('button', { name: `Download CSV for ${SPOKEN}` });
  const download = page.waitForEvent('download');
  await button.click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(`foodz-partner-earnings-${WEEK.from}-to-${WEEK.to}.csv`);
  const path = await file.path();
  const text = readFileSync(path, 'utf8');
  // A BOM, so spreadsheets read accents; CRLF line ends; the header row first (A64).
  expect(text.startsWith('﻿')).toBe(true);
  const lines = text.replace(/^﻿/, '').split('\r\n').filter(Boolean);
  expect(lines[0]).toBe(CSV_HEADER);
  const diego = lines.find((line) => line.includes(',Diego Alvarez,'));
  expect(diego).toBeDefined();
  // A negative balance is a number, never guarded with a quote (A64.2).
  expect(diego?.endsWith(',0.00,-142.70')).toBe(true);
  const luis = lines.find((line) => line.includes(',Luis Moreno,'));
  expect(luis?.endsWith(',96.40,118.38')).toBe(true);
  // The formula guard: no text cell may start with =, +, - or @ unless it carries the quote.
  for (const line of lines.slice(1)) {
    const name = line.split(',')[1] ?? '';
    expect(name).not.toMatch(/^[=+\-@]/);
  }
});

test('the 1280 laptop: the whole table fits without its own scroll', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'admin-1440', 'One width check, from the 1440 project.');
  const secret = skipWithoutAdmin();
  await page.setViewportSize({ width: 1280, height: 800 });
  await signInAdmin(page, secret, REPORT_URL);
  const region = regionOf(page);
  await expect(region).toBeVisible();
  const scrolls = await region.evaluate((element) => element.scrollWidth > element.clientWidth);
  expect(scrolls).toBe(false);
  await noSidewaysScroll(page);
  // The rail can't show sub-items, so the report has its own icon there (design 3.1).
  await expect(page.getByRole('link', { name: 'Earnings and payouts' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expectNoAxeViolations(page);
});

test('SUPPORT and KITCHEN get the no-access page', async ({ page }, testInfo) => {
  await signInStaff(page, STAFF.support, '/admin/partners/earnings');
  await expect(page).toHaveTitle('No access | Foodz Admin');
  await expect(page.getByRole('heading', { level: 1, name: 'No access' })).toBeVisible();
  await expect(
    page.getByText("You don't have access to earnings and payouts. Ask an admin if you need it."),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to partners' })).toBeVisible();
  if (!isPhone(testInfo)) {
    await expect(page.getByRole('link', { name: 'Earnings and payouts' })).toHaveCount(0);
  }
  await expectNoAxeViolations(page);
  // The CSV route answers 403 to SUPPORT too (A63.1).
  const refused = await page.evaluate(async (range) => {
    const response = await fetch('/admin/partners/earnings/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...range, filter: 'all', q: '', sort: 'partner', dir: 'asc' }),
    });
    return response.status;
  }, WEEK);
  expect(refused).toBe(403);

  await page.context().clearCookies();
  await signInStaff(page, STAFF.kitchen, '/admin/partners/earnings');
  await expect(page.getByRole('heading', { level: 1, name: 'No access' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to the board' })).toBeVisible();
});

test('the demo admin: demo partners in full, real money hidden', async ({ page }) => {
  await signInDemoAdmin(page, REPORT_URL);
  await expect(page).toHaveTitle('Earnings and payouts | Foodz Admin');
  await expect(page.getByText('Totals cover demo partners only.')).toBeVisible();
  await expect(
    page.getByText('Hidden for demo staff').filter({ visible: true }).first(),
  ).toBeVisible();
  // No real partner's figures reach the page (A66.1).
  await expect(page.getByText('Owes $142.70')).toHaveCount(0);
  await expect(page.getByText('Foodz owes $118.38')).toHaveCount(0);
  await expectNoAxeViolations(page);
});
