import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import {
  expect,
  expectNoAxeViolationsAtEnd,
  open,
  PARTNERS,
  projectOf,
  SAMPLE_PASSWORD,
  signInTo,
  test,
} from './support';

/*
 * F9's partner screens (design 1): the Earnings tab, its sheets and the period bar, the goal,
 * Home's line, Your ratings, the demo partner's practice week and a suspended partner's
 * read-only earnings. The figures on screen are checked against the partner's own summary route,
 * so the spec holds whatever T the earnings fixtures were written for (`npm run seed:partners`,
 * then `npm run seed:earnings`). Flows that change his goal run in one project only.
 */

const LUIS = 'luis.partner@foodz.example';
const LENA = 'lena.partner@foodz.example';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const price = (cents: number) => usd.format(cents / 100);

interface Summary {
  hasEntries: boolean;
  practice: boolean;
  readOnly: boolean;
  today: { earnedCents: number; deliveries: number; goalCents: number | null };
  week: { start: string; earnedCents: number; isFirstWeek: boolean };
  cash: { state: 'owesYou' | 'handIn' | 'square'; balanceCents: number; hasEntries: boolean };
}

/** Signs in and waits until the page has hydrated (a busy machine lags behind network quiet). */
async function signInReady(page: Page, email: string, path: string) {
  await signInTo(page, email, path);
  await ready(page);
}

async function ready(page: Page) {
  await page.locator('html[data-hydrated]').waitFor({ state: 'attached', timeout: 30_000 });
}

/** Presses a segment's label, as a thumb does (the radio itself is visually hidden). */
async function showPeriod(page: Page, name: 'Today' | 'Week') {
  await page.getByRole('group', { name: 'Show' }).getByText(name, { exact: true }).click();
  await expect(page.getByRole('radio', { name })).toBeChecked();
}

async function summaryOf(page: Page): Promise<Summary> {
  const response = await page.request.get('/api/v1/partner/earnings/summary');
  expect(response.ok()).toBe(true);
  return (await response.json()) as Summary;
}

function cashHeading(cash: Summary['cash']) {
  if (cash.state === 'owesYou') return `Foodz owes you ${price(cash.balanceCents)}`;
  if (cash.state === 'handIn') return `Hand in ${price(-cash.balanceCents)}`;
  return "You're all square.";
}

const onlyOnce = (testInfo: TestInfo) =>
  test.skip(projectOf(testInfo) !== 'partner-375', 'Changes his goal: one project only.');

async function darkTheme(context: BrowserContext, baseURL: string | undefined) {
  await context.addCookies([{ name: 'foodz-partner-theme', value: 'dark', url: baseURL ?? '' }]);
}

async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.beforeEach(() => {
  test.skip(!SAMPLE_PASSWORD, 'Needs the sample password (E2E_SEED_OUTPUT).');
});

test('Luis reads today, the week and the cash card, and they match his figures', async ({
  page,
}, testInfo) => {
  await signInReady(page, LUIS, '/partner/earnings');
  await expect(page).toHaveTitle('Earnings | Foodz Partner');
  const summary = await summaryOf(page);

  // P51.1: three tabs, Earnings current.
  const tabs = page.getByRole('navigation', { name: 'Partner' });
  await expect(tabs.getByRole('link')).toHaveText(['Home', 'Earnings', 'Profile']);
  await expect(tabs.getByRole('link', { name: 'Earnings' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  // P56.1: the cash card is the server's figure, never a guess.
  await expect(
    page.getByRole('heading', { level: 2, name: cashHeading(summary.cash) }),
  ).toBeVisible();
  const today = page.getByRole('region', { name: 'Today' });
  if (summary.hasEntries) {
    await expect(today).toContainText(price(summary.today.earnedCents));
    await expect(today.getByText(/deliver(y|ies) · \$[\d,.]+ tips · online/)).toBeVisible();
  }

  // P56.2: "How this is worked out" shows the server's breakdown and gives focus back.
  if (summary.cash.hasEntries) {
    const link = page.getByRole('button', { name: 'How this is worked out' });
    await link.click();
    const sheet = page.getByRole('dialog', { name: 'How this is worked out' });
    await expect(sheet.getByRole('heading', { name: 'How this is worked out' })).toBeFocused();
    await expect(sheet).toContainText('You earned');
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(link).toBeFocused();
  }

  // P54: the week, seven day buttons, in the address so reload keeps it.
  await showPeriod(page, 'Week');
  await expect(page).toHaveURL(/view=week/);
  await expect(page.getByText('This week', { exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: /^Days, / }).getByRole('button')).toHaveCount(7);
  await expect(page.getByRole('radio', { name: 'Week' })).toBeFocused();
  const week = page.locator('#period');
  await expect(week).toContainText(price(summary.week.earnedCents));
  if (!summary.week.isFirstWeek) {
    await page.getByRole('button', { name: /^Previous week, / }).click();
    await expect(page.getByText('Last week', { exact: true })).toBeVisible();
    await page.reload();
    await ready(page);
    await expect(page.getByText('Last week', { exact: true })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Week' })).toBeChecked();
    // P54.2 and review S1: a day bar moves focus to its header, which sticks right under the
    // status header; the status header stays at the top, with no rows showing above the day.
    const day = page
      .getByRole('list', { name: /^Days, / })
      .getByRole('button')
      .and(page.locator(':not([aria-disabled])'))
      .first();
    if (await day.count()) {
      await day.click();
      const focused = page.locator('h3:focus');
      await expect(focused).toBeFocused();
      await page.waitForTimeout(600);
      const header = await page.locator('header').first().boundingBox();
      const stuck = await focused.boundingBox();
      // The status header stays at the top; the day header never slides under it (it sits right
      // below it, or lower when the list is too short to scroll that far).
      expect(header?.y).toBe(0);
      expect(stuck?.y ?? 0).toBeGreaterThanOrEqual((header?.height ?? 0) - 1);
    }
  } else {
    await expect(page.getByRole('button', { name: /^Previous week, / })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  }
  await expect(page.getByRole('button', { name: /^Next week, / })).toBeVisible();

  // P55.2: a delivery's sheet opens from its row and gives focus back to it.
  const row = page.getByRole('button', { name: /^Order [\w-]+, \d{1,2}:\d{2} [ap]m, \$/ }).first();
  if (await row.isVisible().catch(() => false)) {
    const name = (await row.locator('.sr-only').textContent()) ?? '';
    const order = /^Order ([\w-]+),/.exec(name)?.[1] ?? '';
    await row.click();
    const sheet = page.getByRole('dialog', { name: `Order ${order}` });
    await expect(sheet.getByRole('heading', { name: `Order ${order}` })).toBeFocused();
    await expect(sheet.getByText('Delivery pay')).toBeVisible();
    await expect(sheet.getByText(/^(Accepted|Steps)/).first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(row).toBeFocused();
  }

  await expectNoSidewaysScroll(page);
  await expectNoAxeViolationsAtEnd(page);
  if (projectOf(testInfo) === 'partner-1440') return;
  // P63.1: nothing scrolls sideways at 320, and the bar stays under his thumb.
  await page.setViewportSize({ width: 320, height: 568 });
  await expectNoSidewaysScroll(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const bar = await page.getByRole('radio', { name: 'Today' }).locator('..').boundingBox();
  expect(bar && bar.y > 844 / 2).toBe(true);
});

test('Earnings in the dark theme, and Home links to it', async ({ page, context, baseURL }) => {
  await darkTheme(context, baseURL);
  await signInReady(page, LUIS, '/partner');
  const summary = await summaryOf(page);
  // P51.3: "Today · $19.57 · 3 deliveries" under the status, linking to Earnings.
  // Review P1: no stray space before the comma.
  const line = page.getByRole('link', { name: /^Today · .*[^ ], see earnings$/ });
  await expect(line).toBeVisible();
  const words =
    summary.today.deliveries === 0 && summary.today.earnedCents === 0
      ? 'Today · no deliveries yet'
      : `Today · ${price(summary.today.earnedCents)}`;
  await expect(line).toContainText(words);
  await line.click();
  await expect(page).toHaveURL(/\/partner\/earnings$/);
  await expect(page.locator('.partner')).toHaveClass(/\bdark\b/);
  await expectNoAxeViolationsAtEnd(page);
  await showPeriod(page, 'Week');
  await expectNoAxeViolationsAtEnd(page);
});

test('Luis sets a daily goal, sees the ring, then removes it', async ({ page }, testInfo) => {
  onlyOnce(testInfo);
  await signInReady(page, LUIS, '/partner/earnings');
  const opener = page.getByRole('button', { name: /^(Set a daily goal|Edit goal)$/ });
  await opener.click();
  const sheet = page.getByRole('dialog', { name: 'Your daily goal' });
  await expect(sheet.getByRole('heading', { name: 'Your daily goal' })).toBeFocused();

  // A custom amount outside $10 to $1,000 is refused in place (P53.1).
  await sheet.getByText('Custom', { exact: true }).click();
  const custom = sheet.getByLabel('Goal in dollars');
  await custom.fill('5');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet.getByText('Enter whole dollars from $10 to $1,000.')).toBeVisible();
  await expect(custom).toHaveAttribute('aria-invalid', 'true');
  await expect(custom).toBeFocused();

  await custom.fill('40');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole('main').getByText('Goal saved.')).toBeVisible();
  await expect(page.getByText('of $40 goal')).toBeVisible();
  await expect(
    page.getByText(/^Today \$[\d,.]+(, goal of \$40 reached| of your \$40 goal, \d+ percent)$/),
  ).toBeAttached();
  await expect(page.getByRole('button', { name: 'Edit goal' })).toBeFocused();
  // It's stored on the server: a reload keeps it.
  await page.reload();
  await ready(page);
  await expect(page.getByText('of $40 goal').or(page.getByText('Goal reached'))).toBeVisible();

  await page.getByRole('button', { name: 'Edit goal' }).click();
  await page.getByRole('dialog', { name: 'Your daily goal' }).getByText('No goal').click();
  await page
    .getByRole('dialog', { name: 'Your daily goal' })
    .getByRole('button', { name: 'Save' })
    .click();
  await expect(page.getByRole('button', { name: 'Set a daily goal' })).toBeFocused();
});

test('Lena has nothing yet: all square and the strolling empty state', async ({ page }) => {
  await signInReady(page, LENA, '/partner/earnings');
  await expect(page.getByRole('heading', { name: "You're all square." })).toBeVisible();
  await expect(page.getByRole('button', { name: 'How this is worked out' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'No earnings yet' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/partner');
  await showPeriod(page, 'Week');
  await expect(page.getByText('No deliveries this week.')).toBeVisible();
  await expectNoAxeViolationsAtEnd(page);
});

test('Your ratings from Profile: a figure and never a single rating', async ({ page }) => {
  await signInReady(page, LUIS, '/partner/profile');
  const row = page.getByRole('link', { name: /^Your ratings/ });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page).toHaveTitle('Your ratings | Foodz Partner');
  await expect(page.getByRole('heading', { level: 1, name: 'Your ratings' })).toBeVisible();
  await expect(page.getByText("Ratings don't change which offers you get.")).toBeVisible();
  await expect(page.getByRole('link', { name: /^Call Foodz Kitchen, / })).toHaveAttribute(
    'href',
    /^tel:/,
  );
  await expect(
    page.getByRole('navigation', { name: 'Partner' }).getByRole('link', { name: 'Profile' }),
  ).toHaveAttribute('aria-current', 'page');
  await expectNoAxeViolationsAtEnd(page);
  await page.getByRole('link', { name: 'Profile' }).first().click();
  await expect(page).toHaveURL(/\/partner\/profile$/);
});

test('Riley sees a practice week and a goal for this session only', async ({ page }, testInfo) => {
  test.skip(projectOf(testInfo) !== 'partner-375', 'The demo partner is shared: one project only.');
  await signInReady(page, PARTNERS.riley, '/partner/earnings');
  await expect(page.getByText("Practice data. These aren't real earnings.")).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Foodz owes you \$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Set a daily goal' }).click();
  const sheet = page.getByRole('dialog', { name: 'Your daily goal' });
  await expect(sheet.getByText("Goals aren't saved in the demo.")).toBeVisible();
  await sheet.getByText('$50', { exact: true }).click();
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('of $50 goal')).toBeVisible();
  await page.reload();
  await ready(page);
  await expect(page.getByText('of $50 goal')).toBeVisible();
  await open(page, '/partner/profile/ratings');
  await expect(page.getByText("Practice data. These aren't real ratings.")).toBeVisible();
  await expect(page.getByRole('main').getByText('126 ratings', { exact: true })).toBeVisible();
});

test('Victor, suspended, sees his earnings read-only', async ({ page }) => {
  await signInReady(page, PARTNERS.victor, '/partner');
  await page.getByRole('link', { name: 'See your earnings' }).click();
  await expect(page).toHaveTitle('Your earnings | Foodz Partner');
  await expect(
    page.getByText('Your partner account is suspended. You can still see what Foodz owes you.'),
  ).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Partner' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(Set a daily goal|Edit goal)$/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/partner');
  await expectNoAxeViolationsAtEnd(page);
});
