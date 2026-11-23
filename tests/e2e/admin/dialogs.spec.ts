import {
  card,
  orderHrefOnBoard,
  expect,
  expectNoAxeViolations,
  open,
  showColumn,
  signInStaff,
  STAFF,
  test,
} from './support';

/*
 * The board's dialogs (F5 design 3, A6, A7): validation in words, focus to the first problem,
 * the step-up code. Nothing is submitted that would change the fixtures for good.
 */

test.describe('"Can\'t make it" (A6)', () => {
  test('asks for a reason and the dishes, in words', async ({ page }, testInfo) => {
    await signInStaff(page, STAFF.kitchen, '/admin/orders');
    await showColumn(page, testInfo, /^New/);
    await card(page, 'S1101').getByRole('button', { name: 'More actions for order S1101' }).click();
    await page.getByRole('menuitem', { name: "Can't make it" }).click();
    const dialog = page.getByRole('dialog', { name: "Can't make order S1101?" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: "Can't make order S1101?" })).toBeFocused();
    await dialog.getByRole('button', { name: 'Refuse order' }).click();
    await expect(dialog.getByText('Choose a reason.')).toBeVisible();

    await dialog.getByRole('radio', { name: 'A dish is unavailable' }).check();
    await dialog.getByRole('button', { name: 'Refuse order' }).click();
    await expect(dialog.getByText("Check the dishes you can't make.")).toBeVisible();
    await dialog.getByRole('checkbox', { name: /Pad Thai/ }).check();
    // D21: "Also mark … sold out" is offered and ticked by default.
    await expect(
      dialog.getByRole('checkbox', { name: /^Also mark Pad Thai sold out/ }),
    ).toBeChecked();
    await expect(dialog.getByText("This can't be undone.")).toBeVisible();
    await expectNoAxeViolations(page);

    await dialog.getByRole('button', { name: 'Keep order' }).click();
    await expect(dialog).toBeHidden();
    // Back to the button that opened the menu, not the card's heading (3.1).
    await expect(
      card(page, 'S1101').getByRole('button', { name: 'More actions for order S1101' }),
    ).toBeFocused();
  });
});

test.describe('staff "Cancel order" (A7)', () => {
  test('words the refund and keeps the dialog open on Escape-less errors', async ({
    page,
  }, testInfo) => {
    await signInStaff(page, STAFF.support, '/admin/orders');
    await showColumn(page, testInfo, /^New/);
    await card(page, 'S1102')
      .getByRole('button', { name: /Actions for order S1102/ })
      .click();
    await page.getByRole('menuitem', { name: 'Cancel order' }).click();
    const dialog = page.getByRole('dialog', { name: 'Cancel order S1102?' });
    // The refund line loads with the dialog ("Loading what will happen").
    await expect(
      dialog.getByText("Nothing was charged, so there's nothing to refund."),
    ).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole('radio', { name: 'Other' }).check();
    await dialog.getByRole('button', { name: 'Cancel order' }).click();
    await expect(
      dialog.getByText('Tell us what happened, so support can answer the customer.'),
    ).toBeVisible();
    await expect(dialog.getByLabel('Note for staff')).toBeFocused();
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(
      card(page, 'S1102').getByRole('button', { name: /Actions for order S1102/ }),
    ).toBeFocused();
  });
});

test.describe('the order detail (A10)', () => {
  test('loads as a full page, and a number in place of an id is "Order not found"', async ({
    page,
  }) => {
    await signInStaff(page, STAFF.support, '/admin/orders');
    const href = await orderHrefOnBoard(page, 'S1105');
    expect(href).toMatch(/^\/admin\/orders\/[0-9a-f-]{36}$/);
    await open(page, href ?? '/admin/orders');
    await expect(page.getByRole('heading', { level: 1, name: 'Order S1105' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to the board' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Customer' })).toBeVisible();
    await expectNoAxeViolations(page);

    await open(page, '/admin/orders/1042');
    await expect(page.getByRole('heading', { level: 1, name: 'Order not found' })).toBeVisible();
  });
});
