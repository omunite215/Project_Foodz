import type { Page } from '@playwright/test';
import { expect, expectNoSidewaysScroll, liveRegion, open, test } from '../account/support';
import {
  addToCart,
  answerBankCheck,
  cardFormReady,
  choose,
  confirmedCustomer,
  expectAccessiblePage,
  fillCard,
  openCheckout,
  payButton,
  pickAddress,
  saveWorkAddress,
  stripeReachable,
} from '../checkout-support';
import { isPhone } from './support';

/*
 * Checkout (F4 design 2), the order page it leads to (design 3) and the card payments through
 * Stripe's test mode. Every test orders as a fresh customer with a confirmed email.
 */

const ORDER_URL = /\/orders\/[0-9a-f-]{36}$/;

/** The page's content: the site's live region repeats the same words outside it. */
const inMain = (page: Page) => page.locator('#main');

/** On phones the Summary is a disclosure row; open it to read the figures. */
async function openSummary(page: Page) {
  const disclosure = page.getByRole('button', { name: /^Summary,/ });
  if (
    (await disclosure.isVisible()) &&
    (await disclosure.getAttribute('aria-expanded')) !== 'true'
  ) {
    await disclosure.click();
  }
}

/** The value beside a label in the checkout Summary's price details. */
const priceRow = (page: Page, label: string | RegExp) =>
  page
    .locator('#summary-body dl > div')
    .filter({ has: page.locator('dt', { hasText: label }) })
    .locator('dd');

/** The store keeps hours: when it is closed nothing can be placed (S3.4). */
async function storeOpen(page: Page) {
  await expect(
    payButton(page).or(page.getByRole('button', { name: /^Ordering opens/ })),
  ).toBeVisible();
  return (await page.getByRole('button', { name: /^Ordering opens/ }).count()) === 0;
}

/** A fresh customer with Work saved and two dishes in the cart, on checkout. */
async function readyToPay(page: Page) {
  await confirmedCustomer(page);
  await saveWorkAddress(page);
  await addToCart(page, 'gimbap');
  await addToCart(page, 'pad-thai');
  await openCheckout(page);
  const phone = page.getByLabel('Phone number');
  await phone.fill('(617) 555-0142');
  await phone.blur();
}

test.describe('Checkout', () => {
  test.describe.configure({ timeout: 240_000 });

  test('cash: a first order adds an address and a phone, then shows the order (S2, S4, S5, S11, S12.5)', async ({
    page,
  }, testInfo) => {
    await confirmedCustomer(page);
    await addToCart(page, 'gimbap');
    await addToCart(page, 'pad-thai');
    await openCheckout(page);
    await expect(page).toHaveTitle('Checkout | Foodz');
    await expect(
      inMain(page).getByText('Hooray! This is the last step before your meal.'),
    ).toBeVisible();
    for (const name of ['Deliver to', 'Contact', 'Arrival', 'Tip your courier', 'Payment']) {
      await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
    }

    // No saved address: the button can't place anything yet and says why (S2.3).
    await expect(
      inMain(page).getByText("Add the address you'd like your order delivered to."),
    ).toBeVisible();
    await expect(payButton(page)).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('#pay-reason')).toHaveText('Choose an address we deliver to.');
    await expectAccessiblePage(page);
    if (isPhone(testInfo)) await expectNoSidewaysScroll(page);

    // Add one in the dialog, without leaving checkout (S2.4).
    await page.getByRole('button', { name: 'Add a new address' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add an address' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Add an address' })).toBeFocused();
    await pickAddress(dialog, '1 Faneuil Hall Square Boston', /Boston/);
    await expect(dialog.locator('#delivery-result')).toHaveText(/^We deliver here/, {
      timeout: 20_000,
    });
    await dialog.getByRole('button', { name: 'Save address' }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await expect(liveRegion(page)).toHaveText(/Address saved|Total/);
    const address = page.getByRole('radio', { name: /^Home, default, .*Faneuil Hall/ });
    await expect(address).toBeChecked();

    // The phone is required; a new one offers to be saved, ticked (S2.6, S2.7).
    const phone = page.getByLabel('Phone number');
    await phone.fill('(617) 555-0142');
    await phone.blur();
    await expect(page.getByLabel('Save this number to my profile')).toBeChecked();
    if (isPhone(testInfo)) {
      // The pinned bar steps aside while she types (D5).
      await phone.focus();
      await expect(page.locator('[data-pay-bar]')).toHaveAttribute('data-typing', 'true');
      await phone.blur();
      await expect(page.locator('[data-pay-bar]')).not.toHaveAttribute('data-typing', 'true');
    }

    // Tip by keyboard: "No tip" is chosen first; arrows move through the tiles (S4.1, U1).
    const noTip = page.getByRole('radio', { name: 'No tip' });
    await expect(noTip).toBeChecked();
    await noTip.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    const fifteen = page.getByRole('radio', { name: /^15 %, \$\d+\.\d\d$/ });
    await expect(fifteen).toBeChecked();
    await openSummary(page);
    await expect(priceRow(page, 'Tip for your courier')).not.toHaveText('$0.00');

    // Cash on delivery, chosen by keyboard (S5.1).
    const card = page.getByRole('radio', { name: /^Card, Credit or debit card/ });
    const cash = page.getByRole('radio', { name: /^Cash on delivery/ });
    if (!(await cash.isChecked())) {
      await card.focus();
      await page.keyboard.press('ArrowDown');
    }
    await expect(cash).toBeChecked();
    await expect(
      inMain(page).getByText(/^Pay \$\d+\.\d\d in cash when your order arrives, tip included\./),
    ).toBeVisible();

    if (!(await storeOpen(page))) {
      test.skip(true, 'The store is closed right now; nothing can be placed (S3.4).');
      return;
    }
    await expect(payButton(page)).toHaveText(/^Place order · \$\d+\.\d\d$/);
    const label = (await payButton(page).textContent()) ?? '';
    const total = label.replace('Place order · ', '');

    // Enter in a field never places the order (D47).
    await phone.press('Enter');
    await expect(page).toHaveURL(/\/checkout$/);
    await phone.blur();
    await expectAccessiblePage(page);

    await payButton(page).click();
    await expect(page).toHaveURL(ORDER_URL, { timeout: 30_000 });
    await expect(page).toHaveTitle(/^Order \d+ \| Foodz$/);
    const heading = page.getByRole('heading', { level: 1, name: 'Order placed' });
    await expect(heading).toBeFocused();
    await expect(liveRegion(page)).toHaveText(/^Order placed, order \d+$/);
    await expect(inMain(page).getByText(/^Order \d+$/)).toBeVisible();
    const receipt = page.getByRole('region', { name: 'Receipt' });
    await expect(receipt.getByText('Tip for your courier')).toBeVisible();
    await expect(receipt.getByText(total, { exact: true })).toBeVisible();
    await expect(receipt.getByText(`Cash on delivery · ${total} to pay`)).toBeVisible();
    await expect(page.getByRole('list', { name: 'Order timeline' })).toContainText(
      'Placed · Cash on delivery',
    );
    // The cart is emptied once the order is placed (B16).
    await expect(
      page.locator('header').getByRole('button', { name: 'Cart, empty', includeHidden: true }),
    ).toBeVisible();
    await expectAccessiblePage(page);
    if (isPhone(testInfo)) await expectNoSidewaysScroll(page);

    // Cancel while the kitchen hasn't started (U6, S12.5).
    await page.getByRole('button', { name: 'Cancel order' }).click();
    const cancelDialog = page.getByRole('alertdialog', { name: /^Cancel order \d+\?$/ });
    await expect(cancelDialog.getByText('Nothing has been charged.')).toBeVisible();
    await expect(cancelDialog.getByRole('button', { name: 'Keep order' })).toBeFocused();
    await cancelDialog.getByRole('button', { name: 'Cancel order' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Order cancelled' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole('list', { name: 'Order timeline' })).toContainText(
      'Cancelled by you',
    );
    await expect(page.getByRole('button', { name: 'Cancel order' })).toHaveCount(0);

    // Orders list (S12.1).
    await open(page, '/account/orders');
    const past = page.getByRole('region', { name: 'Past orders' });
    await expect(
      past.getByRole('link', {
        name: /^Order \d+\s*,\s*Cancelled\s*,\s*Today, .* · Cash\s*,\s*Gimbap, Pad Thai/,
      }),
    ).toBeVisible();
    await expectAccessiblePage(page);
  });

  test('card: 4242 pays, the card is saved, and the order page confirms it (S6.4, S6.5, S6.10, S6.13)', async ({
    page,
  }, testInfo) => {
    test.skip(!(await stripeReachable()), 'Stripe test mode is not reachable from this machine.');
    await readyToPay(page);
    if (!(await storeOpen(page))) {
      test.skip(true, 'The store is closed right now; nothing can be placed (S3.4).');
      return;
    }
    await expect(page.getByRole('radio', { name: /^Card, Credit or debit card/ })).toBeChecked();
    await expect(
      inMain(page).getByText(
        'Test mode: no real money moves. Use 4242 4242 4242 4242, any future date and any CVC.',
      ),
    ).toBeVisible();
    await cardFormReady(page);
    await expect(payButton(page)).toHaveText(/^Pay \$\d+\.\d\d$/);

    // An empty card form is checked before anything is sent (S6.3).
    await payButton(page).click();
    await expect(inMain(page).getByText('Enter the card number.')).toBeVisible();
    await expect(page).toHaveURL(/\/checkout$/);

    await fillCard(page, '4242424242424242');
    const save = page.getByLabel('Save this card for next time');
    await expect(save).not.toBeChecked();
    await save.check();
    await expectAccessiblePage(page);
    await payButton(page).click();
    await expect(page).toHaveURL(ORDER_URL, { timeout: 60_000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Order placed' })).toBeVisible({
      timeout: 60_000,
    });
    await expect(
      page.getByRole('region', { name: 'Receipt' }).getByText('Paid · Visa •••• 4242'),
    ).toBeVisible();
    await expectAccessiblePage(page);

    // The saved card is listed and can be removed (S6.13).
    await open(page, '/account/cards');
    const row = page.getByRole('list', { name: 'Saved cards' }).getByRole('listitem');
    await expect(row).toHaveCount(1);
    await expect(row.getByText('Visa •••• 4242')).toBeVisible();
    await expectAccessiblePage(page);
    if (isPhone(testInfo)) await expectNoSidewaysScroll(page);
    await row.getByRole('button', { name: 'Remove Visa ending in 4242' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByRole('button', { name: 'Keep it' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Remove card' }).click();
    await expect(page.getByRole('heading', { name: 'No saved cards' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(liveRegion(page)).toHaveText('Card removed');
  });

  test('3-D Secure: the bank screen opens and Complete pays (S6.6)', async ({ page }) => {
    test.skip(!(await stripeReachable()), 'Stripe test mode is not reachable from this machine.');
    await readyToPay(page);
    if (!(await storeOpen(page))) {
      test.skip(true, 'The store is closed right now; nothing can be placed (S3.4).');
      return;
    }
    await cardFormReady(page);
    await fillCard(page, '4000002500003155');
    await payButton(page).click();
    await expect(
      page.locator('[data-pay-bar]').getByRole('button', { name: 'Waiting for your bank…' }),
    ).toBeVisible({
      timeout: 30_000,
    });
    await answerBankCheck(page, 'Complete');
    await expect(page).toHaveURL(ORDER_URL, { timeout: 60_000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Order placed' })).toBeVisible({
      timeout: 60_000,
    });
  });

  test('a declined card says why, clears the card and keeps every other choice (S6.8, U2)', async ({
    page,
  }) => {
    test.skip(!(await stripeReachable()), 'Stripe test mode is not reachable from this machine.');
    await readyToPay(page);
    if (!(await storeOpen(page))) {
      test.skip(true, 'The store is closed right now; nothing can be placed (S3.4).');
      return;
    }
    await choose(page, /^10 %/);
    await cardFormReady(page);
    await fillCard(page, '4000000000000002');
    await payButton(page).click();
    const alert = inMain(page).getByText(
      'Your card was declined. Try another card, or pay with cash.',
    );
    await expect(alert).toBeVisible({ timeout: 60_000 });
    await expect(liveRegion(page)).toHaveText(
      'Your card was declined. Try another card, or pay with cash.',
    );
    await expect(page).toHaveURL(/\/checkout$/);
    // Everything else she chose stays (S2.9).
    await expect(page.getByLabel('Phone number')).toHaveValue('(617) 555-0142');
    await expect(page.getByRole('radio', { name: /^10 %/ })).toBeChecked();
    await expect(payButton(page)).toHaveText(/^Pay \$\d+\.\d\d$/);
    await expect(payButton(page)).not.toHaveAttribute('aria-disabled', 'true');
    // Failed attempts never show in her orders (S6.8).
    await open(page, '/account/orders');
    await expect(page.getByRole('heading', { name: 'No orders yet' })).toBeVisible();
  });

  test('a total that changed at the press stops it and names the new amount (S8.2, U12)', async ({
    page,
  }) => {
    await readyToPay(page);
    if (!(await storeOpen(page))) {
      test.skip(true, 'The store is closed right now; nothing can be placed (S3.4).');
      return;
    }
    await choose(page, /^Cash on delivery/);
    await expect(payButton(page)).toHaveText(/^Place order · \$\d+\.\d\d$/);
    const shown = ((await payButton(page).textContent()) ?? '').replace('Place order · ', '');

    // The page's figure is a cent off what the server works out: one press is refused.
    let rewritten = false;
    await page.route('**/checkout', async (route) => {
      const request = route.request();
      const body = request.postData() ?? '';
      if (request.method() !== 'POST' || rewritten || !body.includes('expectedTotalCents')) {
        await route.fallback();
        return;
      }
      rewritten = true;
      await route.fallback({
        postData: body.replace(
          /"expectedTotalCents":(\d+)/,
          (_, cents: string) => `"expectedTotalCents":${Number(cents) - 1}`,
        ),
      });
    });
    await payButton(page).click();
    const notice = inMain(page).getByText(
      /^Your total changed from \$\d+\.\d\d to \$\d+\.\d\d\. Check the summary, then press Place order · \$\d+\.\d\d to continue\.$/,
    );
    await expect(notice).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/checkout$/);
    await expect(payButton(page)).toHaveText(`Place order · ${shown}`);

    // One more press places it at the amount on the button.
    await payButton(page).click();
    await expect(page).toHaveURL(ORDER_URL, { timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Order placed' })).toBeVisible();
  });

  test('an unpaid card order: checkout offers to finish paying or cancel it (S7.6, U11, S9.3)', async ({
    page,
    context,
  }) => {
    test.skip(!(await stripeReachable()), 'Stripe test mode is not reachable from this machine.');
    await readyToPay(page);
    if (!(await storeOpen(page))) {
      test.skip(true, 'The store is closed right now; nothing can be placed (S3.4).');
      return;
    }
    await cardFormReady(page);
    await fillCard(page, '4242424242424242');
    // Stripe can't be reached at the press: the order waits for its payment.
    await context.route('https://api.stripe.com/**', (route) => route.abort());
    await payButton(page).click();
    const panel = page.locator('#pay-status');
    await expect(panel).toBeVisible({ timeout: 40_000 });
    await expect(panel).toBeFocused();
    await expect(
      page.locator('[data-pay-bar]').getByRole('button', { name: /^(Pay|Place order)/ }),
    ).toHaveCount(0);
    await panel.getByRole('button', { name: 'Check again' }).click();
    await expect(page).toHaveURL(ORDER_URL, { timeout: 30_000 });
    await expect(
      page.getByRole('heading', { level: 1, name: 'Waiting for payment' }),
    ).toBeVisible();
    await expect(inMain(page).getByText(/^Waiting for payment · \d+ min left$/)).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Finish paying' })).toBeVisible();
    await context.unroute('https://api.stripe.com/**');
    await expectAccessiblePage(page);

    // Back at checkout: finish it or cancel it, never a second unpaid order (U11).
    await addToCart(page, 'kimchi');
    await openCheckout(page);
    const notice = inMain(page).getByText(
      /^Order \d+ is waiting for payment \(\$\d+\.\d\d\)\. It expires at /,
    );
    await expect(notice).toBeVisible();
    await expect(page.locator('#pay-reason')).toHaveText(
      /^Finish paying for order \d+, or cancel it, first\.$/,
    );
    await expect(page.getByRole('link', { name: 'Finish paying' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel it and start again' }).click();
    await expect(
      inMain(page).getByText(/^Order \d+ is cancelled\. You can place your order now\.$/),
    ).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator('#pay-reason')).not.toHaveText(/Finish paying/);
  });

  test('guests are sent to sign in and come back to checkout (S1.1)', async ({ page }) => {
    await open(page, '/checkout');
    await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2Fcheckout&reason=checkout$/);
  });
});
