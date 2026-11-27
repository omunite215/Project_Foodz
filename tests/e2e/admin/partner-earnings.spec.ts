import type { Page, TestInfo } from '@playwright/test';
import {
  expect,
  expectNoAxeViolations,
  isPhone,
  isTablet,
  SAMPLE_PASSWORD,
  signInDemoAdmin,
  signInStaff,
  STAFF,
  test,
} from './support';

/*
 * F9's staff partner screens, read-only (design 3.2 to 3.5, 3.10, 3.16, 3.17): the Partners
 * list's money columns, "Owes cash" and the row menu; the partner page's three sections with
 * the balance, tiles and ledger; Grace's ratings; an order's customer feedback; the demo
 * admin's hidden money. Runs at 375, 1024 and 1440 (and 1280 inside the 1440 run). The money
 * actions are in admin-flows/partner-money.spec.ts.
 *
 * Needs, in this order before the session: the seed with sample accounts, `npm run
 * seed:partners`, then `npm run seed:earnings -- --at=2026-11-20T19:46:00-05:00` (the story's T,
 * as the report spec uses: Diego owes $142.70, Luis is owed $118.38 before order 1042,
 * Grace has 8 ratings), and E2E_ADMIN=1.
 */

test.beforeEach(() => {
  test.skip(!SAMPLE_PASSWORD, 'Needs the sample password (E2E_SEED_OUTPUT).');
});

const APPROVED = '/admin/partners?tab=approved';

/** The fixtures' week: T's Monday to Sunday (seed:earnings --at=T, as the report spec). */
const WEEK = { from: '2026-11-16', to: '2026-11-22' };

/** The ledger opens on the real current week; the fixtures sit in T's week, so open that one. */
async function showFixtureWeek(page: Page) {
  const url = new URL(page.url());
  url.searchParams.set('from', WEEK.from);
  url.searchParams.set('to', WEEK.to);
  await page.goto(url.pathname + url.search);
  await page.locator('html[data-hydrated]').waitFor({ state: 'attached', timeout: 20_000 });
}

/** Diego's row (1024 and up) or card (below). */
function partnerRow(page: Page, testInfo: TestInfo, name: string) {
  return isPhone(testInfo)
    ? page.getByRole('listitem').filter({ has: page.getByRole('link', { name, exact: true }) })
    : page.getByRole('row').filter({ has: page.getByRole('link', { name, exact: true }) });
}

async function openPartner(page: Page, name: string) {
  await page.getByRole('link', { name, exact: true }).first().click();
  await expect(page).toHaveURL(/\/admin\/partners\/[0-9a-f-]{36}\?tab=approved/, {
    timeout: 15_000,
  });
}

test('the list: rating, this week and cash, "Owes cash" and the row menu', async ({
  page,
}, testInfo) => {
  await signInStaff(page, STAFF.support, APPROVED);
  const diego = partnerRow(page, testInfo, 'Diego Alvarez');
  await expect(diego.getByText(/^Owes \$142\.70/)).toBeVisible();
  await expect(diego.getByText(/^Owes Foodz \$142\.70/)).toBeAttached();
  const grace = partnerRow(page, testInfo, 'Grace Okafor');
  await expect(grace.getByText('4.5 · 8')).toBeVisible();
  const omar = partnerRow(page, testInfo, 'Omar Haddad');
  await expect(omar.getByText('4.6 · 31')).toBeVisible();
  if (!isPhone(testInfo)) {
    await expect(page.getByRole('columnheader', { name: 'Rating' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'This week' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Cash' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Actions' })).toBeAttached();
    // Design 3.2: at 1024 the vehicle joins the partner cell and "Partner since" goes.
    const since = page.getByRole('columnheader', { name: 'Partner since' });
    if (isTablet(testInfo)) await expect(since).toBeHidden();
    else await expect(since).toBeVisible();
  }
  await expectNoAxeViolations(page);

  // A57.2: only the partners who owe cash.
  await page.getByRole('button', { name: 'Owes cash' }).click();
  await expect(page).toHaveURL(/owes=1/);
  await expect(page.getByRole('button', { name: 'Owes cash' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(
    page.getByRole('link', { name: 'Diego Alvarez', exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Luis Moreno', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Owes cash' }).click();
  await expect(page).not.toHaveURL(/owes=1/);
  // The whole list is back before a row's menu opens (the rows re-render as it lands).
  await expect(page.getByRole('link', { name: 'Luis Moreno', exact: true }).first()).toBeVisible();

  // The row menu: record cash for Diego; Lena holds nothing, so the menu says so.
  await page.getByRole('button', { name: 'More actions for Diego Alvarez' }).click();
  await expect(page.getByRole('menuitem', { name: 'Record cash handed in' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'See earnings' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'See ratings' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'More actions for Diego Alvarez' })).toBeFocused();
  await page.getByRole('button', { name: 'More actions for Lena Fischer' }).click();
  await expect(page.getByText("Lena isn't holding any cash.")).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Record cash handed in' })).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('the partner page: Earnings first, then Ratings and Application', async ({
  page,
}, testInfo) => {
  await signInStaff(page, STAFF.support, APPROVED);
  await openPartner(page, 'Diego Alvarez');
  await expect(page).toHaveTitle('Partner earnings | Foodz Admin');
  const nav = page.getByRole('navigation', { name: 'Partner sections' });
  await expect(nav.getByRole('link', { name: 'Earnings' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { level: 2, name: 'Earnings' })).toBeVisible();
  await expect(page.getByText(/^Diego owes Foodz \$142\.70 in cash · since /)).toBeVisible();
  await expect(page.getByText("Holding $164.80 in customers' cash")).toBeVisible();
  // SUPPORT records cash; payouts and adjustments are ADMIN's (A60, U5).
  await expect(page.getByRole('button', { name: 'Record cash handed in' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record payout' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Adjust earnings' })).toHaveCount(0);
  await expect(page.getByText(/^This week · Mon, /)).toBeVisible();
  await expect(page.getByText('No payouts yet.')).toBeVisible();
  await showFixtureWeek(page);
  await expect(page.getByRole('heading', { name: 'Entries' })).toBeVisible();
  if (isPhone(testInfo)) {
    await expect(page.getByText('Cash collected').first()).toBeVisible();
  } else {
    const table = page.getByRole('table', { name: /^Diego Alvarez's entries, / });
    await expect(table).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'When' })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    await expect(table.getByRole('cell', { name: 'Cash collected' }).first()).toBeVisible();
  }
  await expectNoAxeViolations(page);

  // Switching sections keeps the address and moves focus to the panel's heading (3.3).
  await nav.getByRole('link', { name: 'Ratings' }).click();
  await expect(page).toHaveURL(/view=ratings/);
  await expect(page).toHaveTitle('Partner ratings | Foodz Admin');
  await expect(page.getByRole('heading', { level: 2, name: 'Ratings' })).toBeFocused();
  await nav.getByRole('link', { name: 'Application' }).click();
  await expect(page).toHaveURL(/view=application/);
  await expect(page).toHaveTitle('Partner application | Foodz Admin');
  await expect(page.getByRole('heading', { level: 2, name: 'Application' })).toBeFocused();
  await page.reload();
  await expect(nav.getByRole('link', { name: 'Application' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test("Luis's ledger at 1280: every entry, the balance after it, who recorded it", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'admin-1440', 'The 1280 check runs inside the 1440 run.');
  await page.setViewportSize({ width: 1280, height: 800 });
  await signInStaff(page, STAFF.support, APPROVED);
  await openPartner(page, 'Luis Moreno');
  await showFixtureWeek(page);
  await expect(page.getByText('Foodz owes Luis $118.38')).toBeVisible();
  // He handed in the cash he collected on Wednesday, so there's no holding line.
  await expect(page.getByText(/^Holding $/)).toHaveCount(0);
  const table = page.getByRole('table', { name: /^Luis Moreno's entries, / });
  await expect(table.getByRole('cell', { name: 'Foodz (automatic)' }).first()).toBeVisible();
  await expect(table.getByRole('cell', { name: 'Morgan Diaz (Support)' }).first()).toBeVisible();
  await expect(page.getByText(/^Showing 1–\d+ of \d+$/)).toBeVisible();
  // SUPPORT reads; only ADMIN downloads the entries (A64).
  await expect(page.getByRole('button', { name: /^Download entries \(CSV\)/ })).toHaveCount(0);
  await expectNoAxeViolations(page);

  // The range: an end before the start is refused under its field.
  await page.getByRole('textbox', { name: 'From', exact: true }).fill('2026-11-22');
  await page.getByRole('textbox', { name: 'To', exact: true }).fill('2026-11-16');
  await page.getByRole('button', { name: 'Show', exact: true }).click();
  await expect(page.getByText("The end date can't be before the start.")).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'To', exact: true })).toBeFocused();
});

test("Grace's ratings, then an order's customer feedback", async ({ page }, testInfo) => {
  await signInStaff(page, STAFF.support, APPROVED);
  await openPartner(page, 'Grace Okafor');
  await page
    .getByRole('navigation', { name: 'Partner sections' })
    .getByRole('link', { name: 'Ratings' })
    .click();
  await expect(page.getByText('8 ratings', { exact: true })).toBeVisible();
  await expect(page.getByText('Shown to customers')).toBeVisible();
  await expect(page.getByText('5 stars: 5 ratings')).toBeAttached();
  await expect(page.getByText('Friendly · 5')).toBeVisible();
  await expect(page.getByText('Late · 1')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'All ratings' })).toBeVisible();
  await expect(page.getByText('Showing 8 of 8')).toBeVisible();
  const exclude = page.getByRole('button', {
    name: /^Exclude from average: 3 stars, .+, order S2205$/,
  });
  await expect(exclude).toBeVisible();
  await expectNoAxeViolations(page);

  // A65: the order's own feedback names the courier and the stars.
  await page.getByRole('link', { name: 'Order S2205' }).click();
  await expect(page).toHaveURL(/\/admin\/orders\/[0-9a-f-]{36}/, { timeout: 15_000 });
  const feedback = page.getByRole('region', { name: 'Customer feedback' });
  await expect(feedback).toBeVisible();
  await expect(feedback.getByText('Grace Okafor · courier')).toBeVisible();
  await expect(feedback.getByText('3 stars')).toBeAttached();
  if (!isPhone(testInfo)) await expectNoAxeViolations(page);
});

test('the demo admin: real partners keep their money hidden', async ({ page }, testInfo) => {
  await signInDemoAdmin(page, APPROVED);
  await expect(
    page.getByText('Hidden for demo staff').filter({ visible: true }).first(),
  ).toBeVisible();
  // A real partner's page: the sections are there, the figures aren't.
  const real = isPhone(testInfo)
    ? page.getByRole('listitem').filter({ hasText: 'Hidden for demo staff' }).first()
    : page.getByRole('row').filter({ hasText: 'Hidden for demo staff' }).first();
  await real.getByRole('link').first().click();
  await expect(page).toHaveTitle('Partner earnings | Foodz Admin', { timeout: 15_000 });
  await expect(page.getByText('Earnings are hidden for demo staff.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record cash handed in' })).toHaveCount(0);
  await expectNoAxeViolations(page);
});
