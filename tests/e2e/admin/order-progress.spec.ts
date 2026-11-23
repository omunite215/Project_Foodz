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
} from './support';

/*
 * The customer's live order page (F5 design 6, S1, S4): Priya's fixtures. S1103 is accepted, so
 * its page shows the stepper at Accepted and the sentence instead of "Cancel order".
 */

test.describe('the live order page', () => {
  test('shows where the order is, and why it can no longer be cancelled', async ({
    page,
    browser,
  }) => {
    test.skip(!SAMPLE_PASSWORD, 'Needs the sample password (E2E_SEED_OUTPUT).');
    // The order's address, read from the support board (the customer's own list has it too).
    const staff = await browser.newPage();
    await signInStaff(staff, STAFF.support, '/admin/orders');
    const href = await card(staff, 'S1103')
      .getByRole('link', { name: 'Order S1103' })
      .getAttribute('href');
    await staff.close();
    const orderId = href?.split('/').at(-1) ?? '';

    await signIn(page, ACCOUNTS.second, SAMPLE_PASSWORD);
    await open(page, `/orders/${orderId}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Order accepted' })).toBeVisible();
    const progress = page.getByRole('list', { name: 'Order progress' });
    await expect(progress.getByText(/^Accepted, now/)).toBeAttached();
    await expect(progress.getByText('Cooking, not yet')).toBeAttached();
    await expect(
      page.getByText(/^The kitchen has accepted your order, so it can't be cancelled here/),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel order' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Timeline' })).toBeVisible();
    await expect(page).toHaveTitle('Accepted · Order S1103 | Foodz');
    await expectNoAxeViolations(page);
  });
});
