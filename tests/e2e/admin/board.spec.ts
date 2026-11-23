import {
  card,
  expect,
  expectNoAxeViolations,
  isPhone,
  showColumn,
  signInDemoAdmin,
  signInStaff,
  STAFF,
  test,
} from './support';

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
    await showColumn(page, testInfo, /^Accepted/);
    await card(page, 'S1103').getByRole('button', { name: 'Start cooking order S1103' }).click();
    await showColumn(page, testInfo, /^Preparing/);
    const moved = card(page, 'S1103');
    await expect(moved.getByText('Moved just now')).toBeVisible({ timeout: 10_000 });
    await moved.getByRole('button', { name: /^Undo, move order S1103 back to Accepted/ }).click();
    await showColumn(page, testInfo, /^Accepted/);
    await expect(
      card(page, 'S1103').getByRole('button', { name: 'Start cooking order S1103' }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('finds an order by its number and keeps filters in the address (A11)', async ({ page }) => {
    await page.getByLabel('Find order').fill(' s1105 ');
    await page.getByRole('button', { name: 'Find' }).click();
    await expect(card(page, 'S1105').getByRole('link', { name: 'Order S1105' })).toBeFocused();
    await page.getByLabel('Find order').fill('9999');
    await page.getByRole('button', { name: 'Find' }).click();
    await expect(page.getByRole('search').getByText('No order 9999.')).toBeVisible();

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
    await expect(panel.getByRole('heading', { name: 'Timeline' })).toBeVisible();
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(card(page, 'S1101').getByRole('link', { name: 'Order S1101' })).toBeFocused();
  });
});

test.describe('the phone board (A16.3)', () => {
  test('uses status tabs over one list', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), 'Phone width only.');
    await signInStaff(page, STAFF.kitchen, '/admin/orders');
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
