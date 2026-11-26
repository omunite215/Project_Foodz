import { Client } from 'pg';
import { signIn } from '../account/support';
import { PARTNERS } from '../partner/support';
import {
  ACCOUNTS,
  card,
  expect,
  expectNoAxeViolations,
  isPhone,
  isTablet,
  open,
  orderHrefOnBoard,
  SAMPLE_PASSWORD,
  showColumn,
  signInStaff,
  STAFF,
  test,
} from './support';

/*
 * The courier on the staff board and the order page (F7 design 2, 3), read only: the board's
 * fixtures have no search running and nobody online (`npm run seed:board`, then
 * `npm run seed:partners`). S1107 has been ready for 16 minutes, so its line is red.
 */

test.beforeEach(() => {
  test.skip(!SAMPLE_PASSWORD, 'Needs the sample password (E2E_SEED_OUTPUT).');
});

/**
 * The seed's Grace, put back just before she's needed: online about 400 m from the kitchen with
 * her last point 3 minutes old. With a job runner attached, the auto-offline job takes the
 * seeded Grace offline within a minute; starting her online time now gives the check 10 minutes.
 * Going online stamps a fresh point (the database's trigger), so the old one is set after it.
 */
async function graceOnlineWithOldPoint() {
  const client = new Client({
    connectionString: process.env.DATABASE_MIGRATOR_URL ?? process.env.DATABASE_URL,
  });
  await client.connect();
  try {
    const grace = `user_id = (SELECT id FROM users WHERE email = $1)`;
    await client.query(
      `UPDATE delivery_partners
       SET is_online = true, online_since = timezone('UTC', now()), offline_reason = NULL,
           offline_at = NULL,
           last_location = ST_SetSRID(ST_MakePoint(-71.044, 42.354), 4326)::geography
       WHERE ${grace}`,
      [PARTNERS.grace],
    );
    await client.query(
      `UPDATE delivery_partners SET last_point_at = timezone('UTC', now()) - interval '3 minutes'
       WHERE ${grace}`,
      [PARTNERS.grace],
    );
  } finally {
    await client.end();
  }
}

test('support sees the courier line, the couriers count and the assign dialog', async ({
  page,
}, testInfo) => {
  await signInStaff(page, STAFF.support, '/admin/orders');
  // The couriers chip: in the top bar from 1280 px, in the toolbar below (D20).
  const chip = page.locator('[data-couriers-chip]').locator('visible=true');
  await expect(chip).toHaveCount(1);
  // The fixtures keep Grace online with an old location; the count never names anyone.
  await expect(chip).toContainText(/^(Couriers · \d+ online · \d+ free|No couriers online)/);
  await expect(chip).not.toContainText('Grace');
  const inTopBar = await chip.evaluate((node) => Boolean(node.closest('header')));
  expect(inTopBar).toBe(!isPhone(testInfo) && !isTablet(testInfo));

  await showColumn(page, testInfo, /^Ready/);
  const order = card(page, 'S1107');
  const line = order.locator('[data-courier-state]');
  await expect(line).toContainText('Not looking for a courier');
  await expect(line).toHaveAttribute('data-tone', 'red');
  // A red courier line turns the whole card red (A39.1).
  await expect(order).toHaveAttribute('data-tone', 'late');
  await expect(order.getByText('Courier: not looking for a courier')).toBeAttached();

  await graceOnlineWithOldPoint();
  await order.getByRole('button', { name: /actions for order S1107/i }).click();
  await expect(page.getByRole('menuitem', { name: 'Find a courier' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Assign courier' }).click();
  const dialog = page.getByRole('dialog', { name: 'Assign a courier to order S1107' });
  await expect(dialog.getByText('Online couriers').first()).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Refresh list' })).toBeVisible();
  // Grace is online with an old location: tagged, but she can still be chosen (A37.2).
  const grace = dialog.getByRole('radio', { name: /^Grace /i });
  await expect(grace).toBeVisible();
  await expect(dialog.getByText(/^Location not shared for \d+ min$/)).toBeVisible();
  // Sending without a choice says so (A37).
  await dialog.getByRole('button', { name: 'Send offer' }).click();
  await expect(dialog.getByText('Choose a courier.')).toBeVisible();
  await expect(grace).toBeFocused();
  await expectNoAxeViolations(page);
  await dialog.getByRole('button', { name: 'Close' }).first().click();
  await expect(dialog).toHaveCount(0);
});

test("the order detail's courier section, and the kitchen's reduced view", async ({
  page,
  browser,
}, testInfo) => {
  await signInStaff(page, STAFF.support, '/admin/orders');
  const href = await orderHrefOnBoard(page, 'S1107');
  await open(page, href ?? '/admin/orders');
  const section = page.locator('[data-courier-section]');
  await expect(section.getByRole('heading', { name: 'Courier' })).toBeVisible();
  await expect(section.getByText('No offers yet.')).toBeVisible();
  await expect(section.getByRole('button', { name: 'Assign courier' })).toBeVisible();
  await expect(section.getByRole('button', { name: 'Find a courier' })).toBeVisible();
  await expectNoAxeViolations(page);

  // KITCHEN: the line only, no offers, no courier actions (A36.4, A40.3).
  const kitchen = await browser.newPage({ viewport: page.viewportSize() ?? undefined });
  await signInStaff(kitchen, STAFF.kitchen, '/admin/orders');
  await showColumn(kitchen, testInfo, /^Ready/);
  const order = card(kitchen, 'S1107');
  await expect(order.locator('[data-courier-state]')).toContainText('Not looking for a courier');
  await order.getByRole('button', { name: /actions for order S1107/i }).click();
  await expect(kitchen.getByRole('menuitem', { name: 'Assign courier' })).toHaveCount(0);
  await kitchen.keyboard.press('Escape');
  await open(kitchen, href ?? '/admin/orders');
  const reduced = kitchen.locator('[data-courier-section]');
  await expect(reduced.getByRole('heading', { name: 'Courier' })).toBeVisible();
  await expect(reduced.getByText('No offers yet.')).toHaveCount(0);
  await expect(reduced.getByRole('button', { name: 'Assign courier' })).toHaveCount(0);
  await kitchen.close();
});

// S3.1: S1107's search never ran ("Not looking for a courier" on the board), so the customer
// reads the slow line, not "finding a courier".
test("the customer's line while no courier is being found", async ({ page, browser }) => {
  const staff = await browser.newPage();
  await signInStaff(staff, STAFF.support, '/admin/orders');
  const href = await orderHrefOnBoard(staff, 'S1107');
  await staff.close();
  await signIn(page, ACCOUNTS.second, SAMPLE_PASSWORD);
  await open(page, `/orders/${href?.split('/').at(-1) ?? ''}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Your food is ready' })).toBeVisible();
  await expect(
    page
      .getByRole('main')
      .getByText(
        "It's packed, but finding a courier is taking longer than usual. We're on it and will update this page.",
      )
      .first(),
  ).toBeVisible();
  await expect(page.getByText("We're finding a courier to bring it to you.")).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Your courier' })).toHaveCount(0);
  await expectNoAxeViolations(page);
});
