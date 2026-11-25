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
 * The staff live map (F8 design 3.1 to 3.7, A46, A47, A55): the sidebar entry, the list and
 * the map side by side from 1024 px or one at a time with a toggle at 375, the map key, the
 * demo admin's own pool with "Run a demo delivery", and the kitchen's no-access page. Read-only:
 * nothing here changes an order.
 */

test.beforeEach(() => {
  test.skip(!SAMPLE_PASSWORD, 'Needs the sample password (E2E_SEED_OUTPUT).');
});

test('support sees couriers and deliveries beside the map, or one at a time on a phone', async ({
  page,
}, testInfo) => {
  await signInStaff(page, STAFF.support, '/admin/map');
  await expect(page).toHaveTitle('Live map | Foodz Admin');
  await expect(page.getByRole('heading', { level: 1, name: 'Live map' })).toBeVisible();
  const list = page.getByRole('navigation', { name: 'Couriers and deliveries' });
  await expect(list.getByRole('tab', { name: /^Couriers · \d+$/ })).toBeVisible();
  await expect(list.getByRole('tab', { name: /^Deliveries · \d+$/ })).toBeVisible();

  if (isPhone(testInfo)) {
    // One view at a time (A55.1): the list first, then the map with its text note.
    await expect(page.locator('[data-map-state]')).toHaveCount(0);
    await expectNoAxeViolations(page);
    await page.getByRole('radio', { name: 'Map' }).click();
    await expect(list).toBeHidden();
    await expect(page.locator('[data-map-state]')).toHaveCount(1);
    await expect(
      page.getByText(
        'The map shows the same couriers and deliveries as the list. Switch to the list to go through them.',
      ),
    ).toBeAttached();
    await page.getByRole('radio', { name: 'List' }).click();
    await expect(list).toBeVisible();
  } else {
    // Two columns from 1024 px (design 3.2): the list and the map at once.
    await expect(page.locator('[data-map-state]')).toHaveCount(1);
    await expect(page.getByRole('radio', { name: 'Map' })).toBeHidden();
    if (!isTablet(testInfo)) {
      await expect(page.getByRole('link', { name: 'Live map' })).toHaveAttribute(
        'aria-current',
        'page',
      );
    }
  }

  // The map key names every state in words (D24).
  await page.getByRole('button', { name: 'Map key' }).click();
  for (const word of ['Free', 'Offered', 'To kitchen', 'Delivering', 'No answer', 'Code locked']) {
    await expect(page.getByText(word, { exact: true }).first()).toBeVisible();
  }
  await expectNoAxeViolations(page);
  await page.getByRole('button', { name: 'Map key' }).click();

  await list.getByRole('tab', { name: /^Deliveries/ }).click();
  await expect(list.getByRole('tab', { name: /^Deliveries/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expectNoAxeViolations(page);
});

test('the demo admin sees the demo pool and the demo delivery control', async ({
  page,
}, testInfo) => {
  test.skip(isPhone(testInfo), 'The demo control is the same at every width.');
  await signInDemoAdmin(page, '/admin/map');
  await expect(page.getByRole('heading', { level: 1, name: 'Live map' })).toBeVisible();
  await expect(
    page
      .getByRole('button', { name: 'Run a demo delivery' })
      .or(page.getByText(/^Demo delivery running/)),
  ).toBeVisible();
  await expectNoAxeViolations(page);
});

test("the kitchen can't open the live map", async ({ page }, testInfo) => {
  test.skip(!isPhone(testInfo), 'The gate is the same at every width.');
  await signInStaff(page, STAFF.kitchen, '/admin/orders');
  await open(page, '/admin/map');
  await expect(page).toHaveTitle('No access | Foodz Admin');
  await expect(
    page.getByText("You don't have access to the live map. Ask an admin if you need it."),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to the board' })).toBeVisible();
  await expectNoAxeViolations(page);
});
