import type { Page } from '@playwright/test';
import {
  card,
  expect,
  expectNoAxeViolations,
  isPhone,
  isTablet,
  showColumn,
  signInDemoAdmin,
  signInStaff,
  STAFF,
  test,
} from './support';

/**
 * Nothing on the board runs past its edge (design 2.5, 1.3): no column list scrolls sideways,
 * every visible part of a card stays inside it, the top bar's h1 is whole, and the status chips
 * never slide under the controls at the end.
 */
async function expectNothingOverflows(page: Page) {
  const problems = await page.evaluate(() => {
    const found: string[] = [];
    for (const list of document.querySelectorAll<HTMLElement>('#board ul')) {
      if (list.clientWidth > 0 && list.scrollWidth > list.clientWidth + 1) {
        found.push(
          `list ${list.closest('section')?.id}: ${list.scrollWidth} > ${list.clientWidth}`,
        );
      }
    }
    for (const article of document.querySelectorAll<HTMLElement>('#board article')) {
      const box = article.getBoundingClientRect();
      if (box.width === 0) continue;
      for (const part of article.querySelectorAll<HTMLElement>('p, span, button, a, li')) {
        if (part.closest('.sr-only')) continue;
        const rect = part.getBoundingClientRect();
        if (rect.width === 0) continue;
        if (rect.right > box.right + 1 || rect.left < box.left - 1) {
          found.push(`${article.dataset.order}: "${part.textContent?.trim().slice(0, 40)}"`);
        }
      }
    }
    const title = document.querySelector<HTMLElement>('header h1');
    const bar = title?.closest('header');
    if (title && bar) {
      if (title.scrollWidth > title.clientWidth + 1) found.push(`h1 cut: ${title.textContent}`);
      if (bar.scrollWidth > bar.clientWidth + 1) found.push('top bar runs past its edge');
      const status = title.nextElementSibling;
      const end = bar.lastElementChild;
      if (status && end && status !== end) {
        const statusRight = status.getBoundingClientRect().right;
        if (statusRight > end.getBoundingClientRect().left + 1) found.push('chips under controls');
      }
    }
    return found;
  });
  expect(problems).toEqual([]);
}

/*
 * The order board with the seeded fixtures (F5 design 2, A2 to A5, A11, A14). Run
 * `npm run seed:board` first: S1101 to S1108 are placed relative to that moment.
 */

test.describe('the kitchen board (A2)', () => {
  test.beforeEach(async ({ page }) => {
    await signInStaff(page, STAFF.kitchen, '/admin/orders');
    await expect(page.getByRole('heading', { level: 1, name: 'Order board' })).toBeVisible();
  });

  test('shows every live order in its column, with lateness in words', async ({
    page,
  }, testInfo) => {
    await expect(page).toHaveTitle('Order board | Foodz Admin');
    if (!isPhone(testInfo)) {
      await expect(page.getByRole('heading', { name: /^New, \d orders?/ })).toBeVisible();
      await expect(page.getByRole('heading', { name: /^Preparing, \d orders/ })).toBeVisible();
      // The kitchen never sees Out for delivery (A2.1).
      await expect(page.getByRole('heading', { name: /^Out for delivery/ })).toHaveCount(0);
    }
    await expect(card(page, 'S1102')).toHaveAttribute('data-tone', 'late');
    await expect(card(page, 'S1102').getByText(/late, waiting \d+ min/i)).toBeAttached();
    // A2.3: the kitchen sees no amounts and no contact details.
    await expect(card(page, 'S1101').getByText('Card · paid')).toBeVisible();
    await expect(page.getByText(/\$\d/)).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('shows notes as text (A2.9)', async ({ page }, testInfo) => {
    await showColumn(page, testInfo, /^Preparing/);
    await expect(card(page, 'S1105').getByText('<b>extra rice</b>')).toBeVisible();
  });

  test('moves an order in one tap, then takes it back with Undo (A4.2, A8.1)', async ({
    page,
  }, testInfo) => {
    // The viewports run side by side on shared fixtures, so each moves its own order; 1440
    // only differs in width from 1024.
    test.skip(!isPhone(testInfo) && !isTablet(testInfo), 'Covered at 375 and 1024.');
    const move = isPhone(testInfo)
      ? { number: 'S1103', from: 'Accepted', to: 'Preparing', button: 'Start cooking' }
      : { number: 'S1104', from: 'Preparing', to: 'Ready', button: 'Mark ready' };
    const press = `${move.button} order ${move.number}`;
    // Reduced motion: nothing travels, so the moved card is outlined in its new column (D20).
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await showColumn(page, testInfo, new RegExp(`^${move.from}`));
    await card(page, move.number).getByRole('button', { name: press }).click();
    await showColumn(page, testInfo, new RegExp(`^${move.to}`));
    const moved = card(page, move.number);
    if (!isPhone(testInfo)) await expect(moved).toHaveCSS('outline-style', 'solid');
    await expect(moved.getByText('Moved just now')).toBeVisible({ timeout: 10_000 });
    // F7 A34.1: the courier line shows from the start, long before any offer.
    if (move.to === 'Ready') {
      await expect(moved.getByText('Finding a courier…')).toBeVisible({ timeout: 4_000 });
    }
    await moved
      .getByRole('button', {
        name: new RegExp(`^Undo, move order ${move.number} back to ${move.from}`),
      })
      .click();
    await showColumn(page, testInfo, new RegExp(`^${move.from}`));
    await expect(card(page, move.number).getByRole('button', { name: press })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('finds an order by its number and keeps filters in the address (A11)', async ({ page }) => {
    await page.getByLabel('Find order').fill(' s1105 ');
    await page.getByRole('button', { name: 'Find' }).click();
    await expect(card(page, 'S1105').getByRole('link', { name: 'Order S1105' })).toBeFocused();
    await page.getByLabel('Find order').fill('9999');
    await page.getByRole('button', { name: 'Find' }).click();
    await expect(page.getByRole('search').getByText('No order 9999.')).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole('button', { name: 'Late only' }).click();
    await expect(page).toHaveURL(/late=1/);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Late only' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page).not.toHaveURL(/late=1/);
  });

  test('opens the detail as a panel, and Escape returns to the card (A10.1)', async ({
    page,
  }, testInfo) => {
    test.skip(isPhone(testInfo), 'The panel is full screen on phones; covered at 1024 and 1440.');
    await card(page, 'S1101').getByRole('link', { name: 'Order S1101' }).click();
    const panel = page.getByRole('dialog', { name: 'Order S1101' });
    await expect(panel).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/orders\/[0-9a-f-]{36}$/);
    await expect(panel.getByRole('heading', { name: 'Timeline' })).toBeVisible({
      timeout: 15_000,
    });
    // The tab names the order open over the board (A1.9).
    await expect(page).toHaveTitle('Order S1101 | Foodz Admin');
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(card(page, 'S1101').getByRole('link', { name: 'Order S1101' })).toBeFocused();
  });
});

test.describe('fit and states (design review)', () => {
  test('nothing runs past its edge, live or offline', async ({ page, context }) => {
    await signInStaff(page, STAFF.kitchen, '/admin/orders');
    await expect(page.getByText('Live', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expectNothingOverflows(page);
    await context.setOffline(true);
    await expect(page.getByText('Offline', { exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });
    await expectNothingOverflows(page);
    await context.setOffline(false);
  });

  test("support's cards fit their columns, amounts included", async ({ page }) => {
    await signInStaff(page, STAFF.support, '/admin/orders');
    await expect(page.getByText(/to collect/).first()).toBeAttached();
    await expectNothingOverflows(page);
  });

  test('signed out: the card takes focus and "Sign in again" works (1.7)', async ({
    page,
    context,
  }) => {
    await signInStaff(page, STAFF.kitchen, '/admin/orders');
    // The session ends on the server; the board finds out on its next request. A search is
    // used for that request because it changes nothing, whatever happens.
    const origin = new URL(page.url()).origin;
    const ended = await page.request.post('/api/auth/sign-out', {
      headers: { origin, 'content-type': 'application/json' },
      data: {},
    });
    expect(ended.ok()).toBe(true);
    await context.clearCookies();
    const heading = page.getByRole('heading', { name: "You've been signed out" });
    // Coming back to the tab reads the board again, which finds the session gone. A search
    // is the fallback; it changes nothing either.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    const noticed = await heading
      .waitFor({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (!noticed) {
      await page.getByLabel('Find order').fill('9999');
      await page.getByRole('button', { name: 'Find' }).click();
    }
    await expect(heading).toBeFocused({ timeout: 15_000 });
    await expectNothingOverflows(page);
    await page.keyboard.press('Tab');
    const again = page.getByRole('link', { name: 'Sign in again' });
    await expect(again).toBeFocused();
    await again.click();
    await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2Fadmin%2Forders/);
  });
});

test.describe('filters and the sold-out sheet (A11.2, design review R2-3)', () => {
  test('two quick taps keep both filters', async ({ page }) => {
    await signInStaff(page, STAFF.kitchen, '/admin/orders');
    await page.getByRole('button', { name: 'Late only' }).click();
    await page.getByRole('radio', { name: 'Cash' }).click();
    // The address follows each tap once the server has drawn the board for it.
    await expect(page).toHaveURL(/late=1/, { timeout: 15_000 });
    await expect(page).toHaveURL(/pay=cash/, { timeout: 15_000 });
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page).not.toHaveURL(/late=1|pay=cash/, { timeout: 15_000 });
  });

  test('the sold-out sheet opens with its rows, never an empty body', async ({ page }) => {
    await signInStaff(page, STAFF.kitchen, '/admin/orders');
    await page
      .getByRole('button', { name: /^Sold out/ })
      .first()
      .click();
    const sheet = page.getByRole('dialog', { name: 'Dish availability' });
    await expect(
      sheet.getByRole('listitem').first().or(sheet.locator('[data-dishes-loading]')),
    ).toBeVisible({ timeout: 1_000 });
    await expect(sheet.getByRole('button', { name: /^Mark .+ sold out$/ }).first()).toBeVisible();
  });
});

test.describe('the phone board (A16.3)', () => {
  test('uses status tabs over one list', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), 'Phone width only.');
    await signInStaff(page, STAFF.kitchen, '/admin/orders');
    // Order numbers are 44 px targets on phones.
    const number = card(page, 'S1101').getByRole('link', { name: 'Order S1101' });
    expect((await number.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(page.getByRole('tab', { name: /^New 2/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.getByRole('tab', { name: /^Ready/ }).click();
    await expect(page).toHaveURL(/#ready$/);
    await expect(card(page, 'S1107')).toBeVisible();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(375);
  });
});

test.describe('the demo admin (A14)', () => {
  test('sees every action disabled, and the banner', async ({ page }, testInfo) => {
    await signInDemoAdmin(page);
    await expect(page.getByText(/^Demo admin: you can look around/)).toBeVisible();
    await showColumn(page, testInfo, /^New/);
    const accept = card(page, 'S1101').getByRole('button', { name: 'Accept order S1101' });
    await expect(accept).toHaveAttribute('aria-disabled', 'true');
    await expect(card(page, 'S1101').getByText('Read-only in the demo')).toBeVisible();
    await expectNoAxeViolations(page);
  });
});
