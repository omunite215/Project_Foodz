import { execSync } from 'node:child_process';
import { signIn } from '../account/support';
import {
  ACCOUNTS,
  card,
  expect,
  expectNoAxeViolations,
  open,
  SAMPLE_PASSWORD,
  signInStaff,
  STAFF,
  test,
} from '../admin/support';

/*
 * The customer hears about a refusal at once (S6.4, design 9) and orders the same again without
 * the dish the kitchen ran out of (S7.5, design 8). It changes fixture S1101 for good, so it
 * runs after the other admin projects, resets the fixtures first, and one viewport at a time.
 */

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  execSync('npm run seed:board', { stdio: 'ignore', env: process.env, timeout: 120_000 });
});

test('a refusal reaches the customer as a notice, and Order again leaves the dish out', async ({
  page,
  browser,
}) => {
  test.skip(!SAMPLE_PASSWORD, 'Needs the sample password (E2E_SEED_OUTPUT).');
  // Priya browses the menu with her order S1101 still New.
  await signIn(page, ACCOUNTS.second, SAMPLE_PASSWORD);
  await open(page, '/menu');

  // Alex can't make it: Pad Thai is unavailable (the menu keeps it on).
  const kitchenContext = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const kitchen = await kitchenContext.newPage();
  await signInStaff(kitchen, STAFF.kitchen, '/admin/orders');
  await card(kitchen, 'S1101')
    .getByRole('button', { name: 'More actions for order S1101' })
    .click();
  await kitchen.getByRole('menuitem', { name: "Can't make it" }).click();
  const dialog = kitchen.getByRole('dialog', { name: "Can't make order S1101?" });
  await dialog.getByRole('radio', { name: 'A dish is unavailable' }).check();
  await dialog.getByRole('checkbox', { name: /Pad Thai/ }).check();
  await dialog.getByRole('checkbox', { name: /^Also mark Pad Thai sold out/ }).uncheck();
  await dialog.getByRole('button', { name: 'Refuse order' }).click();
  await expect(card(kitchen, 'S1101')).toHaveCount(0, { timeout: 15_000 });
  await kitchenContext.close();

  // The notice, in her visible tab: words, "View order" and "Dismiss" (design 9).
  const notices = page.getByRole('complementary', { name: 'Order updates' });
  const notice = notices.getByRole('region', { name: 'Order S1101 is cancelled' });
  await expect(notice).toBeVisible({ timeout: 15_000 });
  await expect(notice.getByRole('link', { name: 'View order S1101' })).toHaveAttribute(
    'href',
    /^\/orders\/[0-9a-f-]{36}$/,
  );
  await expectNoAxeViolations(page);
  // A cancellation stays until dismissed.
  await page.waitForTimeout(11_000);
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: 'Dismiss notice about order S1101' }).click();
  await expect(notices).toHaveCount(0);

  // "Order again" on her orders list: Gimbap goes in, Pad Thai is left out, and the cart says so.
  await open(page, '/account/orders');
  const row = page
    .locator('[data-order-row]')
    .filter({ has: page.getByRole('link', { name: 'Order S1101', exact: true }) });
  await row.getByRole('button', { name: 'Order again: order S1101' }).click();
  const cart = page.getByRole('dialog', { name: 'Your cart' });
  await expect(cart).toBeVisible({ timeout: 15_000 });
  await expect(
    cart.getByText('The kitchen ran out of Pad Thai today, so we left it out.'),
  ).toBeVisible();
  await expect(cart.getByText('Gimbap', { exact: false }).first()).toBeVisible();
  await expectNoAxeViolations(page);
  await cart.getByRole('button', { name: 'Dismiss' }).first().click();
  await expect(cart.getByText('The kitchen ran out of Pad Thai today')).toHaveCount(0);
});
