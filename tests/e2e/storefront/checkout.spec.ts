import type { Page } from '@playwright/test';
import {
  expect,
  expectNoSidewaysScroll,
  liveRegion,
  newPassword,
  open,
  signIn,
  signUp,
  test,
  uniqueEmail,
  watchConsole,
} from '../account/support';
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
import { isPhone, openCart } from './support';

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
  // Decide on the settled quote, not on the first paint: before the quote the button still reads
  // "Pay" whatever the hours. The Arrival box says one of these once the quote is in.
  await expect(page.getByRole('region', { name: 'Arrival' })).toContainText(
    /Arrives in about|Choose an address to see when it arrives|Ordering opens|when your total updates/,
    { timeout: 30_000 },
  );
  const closed =
    (await page.getByRole('button', { name: /^Ordering opens/ }).count()) > 0 ||
    (await inMain(page)
      .getByText(/^We're closed right now/)
      .count()) > 0;
  return !closed;
}

/** A fresh customer with Work saved and two dishes in the cart, on checkout. */
async function readyToPay(page: Page) {
  const account = await confirmedCustomer(page);
  await saveWorkAddress(page);
  await addToCart(page, 'gimbap');
  await addToCart(page, 'pad-thai');
  await openCheckout(page);
  const phone = page.getByLabel('Phone number');
  await phone.fill('(617) 555-0142');
  await phone.blur();
  return account;
}

/** Signs out from the header; with dishes in the cart the dialog asks first. */
async function signOutHere(page: Page) {
  await page.getByRole('button', { name: /^Account menu for / }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Sign out?' });
  const signedOut = page.locator('header').getByRole('link', { name: 'Sign in' });
  await expect(confirm.or(signedOut)).toBeVisible({ timeout: 15_000 });
  if (await confirm.isVisible()) await confirm.getByRole('button', { name: 'Sign out' }).click();
  await expect(signedOut).toBeVisible({ timeout: 15_000 });
}

/** What checkout keeps in this tab (note, tip, attempt key, the order just placed). */
const checkoutKeys = (page: Page) =>
  page.evaluate(() =>
    Object.keys(sessionStorage).filter(
      (key) => key.startsWith('foodz.checkout.') || key.startsWith('foodz.order.'),
    ),
  );

test.describe('Checkout', () => {
  test.describe.configure({ timeout: 240_000 });

  test('cash: a first order adds an address and a phone, then shows the order (S2, S4, S5, S11, S12.5)', async ({
    page,
  }, testInfo) => {
    const problems = watchConsole(page);
    await confirmedCustomer(page);
    await addToCart(page, 'gimbap');
    await addToCart(page, 'pad-thai');
    await openCheckout(page);
    // At night nothing can be placed (S3.4): checked first, as everything below is the open store.
    if (!(await storeOpen(page))) {
      test.skip(true, 'The store is closed right now; nothing can be placed (S3.4).');
      return;
    }
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
    // Focus lands on the new card, not on the page (design 2.8).
    await expect(address).toBeFocused();

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

    await expect(payButton(page)).toHaveText(/^Place order · \$\d+\.\d\d$/);
    const label = (await payButton(page).textContent()) ?? '';
    const total = label.replace('Place order · ', '');

    // Enter in a field never places the order (D47).
    await phone.press('Enter');
    await expect(page).toHaveURL(/\/checkout$/);
    await phone.blur();
    const note = page.getByLabel(/^Note for the kitchen/);
    await note.fill('Extra napkins please');
    await note.blur();
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
    // The emptied cart says why, with the way back to the order (B16).
    const cart = await openCart(page);
    await expect(
      cart.getByText(/^Order \d+ is placed\. Your cart has been emptied\./),
    ).toBeVisible();
    await expect(cart.getByRole('link', { name: 'View your order' })).toHaveAttribute(
      'href',
      new URL(page.url()).pathname,
    );
    await page.keyboard.press('Escape');
    await expect(cart).toBeHidden();
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
    // No script errors on the way: no hydration mismatch, nothing the CSP refused.
    expect(problems).toEqual([]);

    // The next order in this tab starts afresh: no tip, no note she didn't type for it (S4.1).
    await addToCart(page, 'kimchi');
    await openCheckout(page);
    await expect(page.getByRole('radio', { name: 'No tip' })).toBeChecked();
    await expect(page.getByLabel(/^Note for the kitchen/)).toHaveValue('');

    // Orders list (S12.1).
    await open(page, '/account/orders');
    const past = page.getByRole('region', { name: 'Past orders' });
    await expect(
      past.getByRole('link', {
        // The payment word: in the date line below 1280 px, under the total from there.
        name: /^(?=.*\bCash\b)Order \d+\s*,\s*Cancelled\s*,\s*Today, [^,]*?(?: · Cash)?\s*,\s*Gimbap, Pad Thai/,
      }),
    ).toBeVisible();
    await expectAccessiblePage(page);
  });

  test('card: 4242 pays, the card is saved, and the order page confirms it (S6.4, S6.5, S6.10, S6.11, S6.13)', async ({
    page,
    context,
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

    // The next order with the saved card, left unpaid (Stripe unreachable at the press): its
    // "Finish paying" shows that card chosen, and pays with it (S6.11).
    await addToCart(page, 'kimchi');
    await openCheckout(page);
    const savedAtCheckout = page.getByRole('radio', { name: 'Visa ending in 4242, expires 12/34' });
    await expect(savedAtCheckout).toBeChecked();
    await context.route('https://api.stripe.com/**', (route) => route.abort());
    await payButton(page).click();
    const panel = page.locator('#pay-status');
    await expect(panel).toBeVisible({ timeout: 40_000 });
    await panel.getByRole('button', { name: 'Check again' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Waiting for payment' })).toBeVisible({
      timeout: 30_000,
    });
    await context.unroute('https://api.stripe.com/**');
    const step = page.getByRole('region', { name: 'Finish paying' });
    const savedOnStep = step.getByRole('radio', { name: 'Visa ending in 4242, expires 12/34' });
    await expect(savedOnStep).toBeChecked();
    await expect(step.getByRole('radio', { name: 'Use a new card' })).not.toBeChecked();
    await step.getByRole('button', { name: /^Pay \$\d+\.\d\d$/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Order placed' })).toBeVisible({
      timeout: 60_000,
    });
    await expect(
      page.getByRole('region', { name: 'Receipt' }).getByText('Paid · Visa •••• 4242'),
    ).toBeVisible();

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

  test('a press answered late: the panel checks again and moves on before the answer arrives (S7.3, D22)', async ({
    page,
    clientIp,
  }) => {
    await readyToPay(page);
    if (!(await storeOpen(page))) {
      test.skip(true, 'The store is closed right now; nothing can be placed (S3.4).');
      return;
    }
    await choose(page, /^Cash on delivery/);
    await expect(payButton(page)).toHaveText(/^Place order · \$\d+\.\d\d$/);

    // The server takes the press at once (the order is placed), but its answer reaches the page
    // only 35 s later. The re-checks must not wait for it.
    let held = false;
    let released = false;
    await page.route('**/checkout', async (route) => {
      const request = route.request();
      if (
        request.method() !== 'POST' ||
        held ||
        !request.postData()?.includes('expectedTotalCents')
      ) {
        await route.fallback();
        return;
      }
      held = true;
      const response = await route.fetch({
        headers: { ...request.headers(), 'x-forwarded-for': clientIp },
      });
      await new Promise((resolve) => setTimeout(resolve, 35_000));
      released = true;
      await route.fulfill({ response }).catch(() => undefined);
    });
    await payButton(page).click();
    const panel = page.locator('#pay-status');
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(panel).toBeFocused();
    // Nothing she chose can change while the press may still be going through (D21).
    await expect(page.locator('#checkout')).toHaveAttribute('inert');

    // "Check again" reaches the server while the press is still out, and the page moves on.
    const checked = page.waitForResponse(
      (response) => response.url().includes('/api/checkout/attempt?key=') && response.ok(),
      { timeout: 10_000 },
    );
    await panel.getByRole('button', { name: 'Check again' }).click();
    await checked;
    await expect(page).toHaveURL(ORDER_URL, { timeout: 15_000 });
    expect(released).toBe(false);
    await expect(page.getByRole('heading', { level: 1, name: 'Order placed' })).toBeVisible();
  });

  test('signing out forgets the kitchen note for the next person on the tab (security S12)', async ({
    page,
  }) => {
    await readyToPay(page);
    const note = page.getByLabel(/^Note for the kitchen/);
    await note.fill('Peanut allergy, buzzer 4B broken');
    await note.blur();
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem('foodz.checkout.choices') ?? ''))
      .toContain('Peanut allergy');

    await signOutHere(page);
    expect(await checkoutKeys(page)).toEqual([]);

    // Someone else signs in on the same tab: nothing of the last order is offered.
    await signUp(page);
    await addToCart(page, 'kimchi');
    await openCheckout(page);
    await expect(page.getByLabel(/^Note for the kitchen/)).toHaveValue('');
    await expect(page.getByLabel('Name for the order')).toHaveValue('Maya Lopez');
  });

  test('an unpaid card order: checkout offers to finish paying or cancel it (S7.6, U11, S9.3)', async ({
    page,
    context,
  }) => {
    test.skip(!(await stripeReachable()), 'Stripe test mode is not reachable from this machine.');
    const account = await readyToPay(page);
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
    const orderPath = new URL(page.url()).pathname;
    await addToCart(page, 'kimchi');
    // The cart says so first, with the way to finish paying (S7.6).
    const cart = await openCart(page);
    await expect(cart.getByText(/^You have an unpaid order \d+\./)).toBeVisible();
    await expect(cart.getByRole('link', { name: 'Finish paying' })).toHaveAttribute(
      'href',
      orderPath,
    );
    await page.keyboard.press('Escape');
    await expect(cart).toBeHidden();

    // Signed out, the cart says nothing about her unpaid order (security S12).
    await signOutHere(page);
    const guestCart = await openCart(page);
    await expect(guestCart.getByRole('heading', { name: 'Your cart is empty' })).toBeVisible();
    await expect(guestCart.getByText(/You have an unpaid order/)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await signIn(page, account.email, account.password);
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

  test('an address checked as a guest is offered, filled in, once she has an account (S2.5, D10)', async ({
    page,
  }) => {
    // As a guest: a dish, and an address checked in the cart without saving it.
    await addToCart(page, 'gimbap');
    const cart = await openCart(page);
    const delivery = cart.getByRole('region', { name: 'Delivery' });
    await delivery.getByRole('button', { name: 'Check your address' }).click();
    const field = delivery.getByRole('combobox', { name: 'Your address' });
    await field.pressSequentially('1 Faneuil Hall Square Boston', { delay: 25 });
    const options = cart.getByRole('listbox', { name: 'Address suggestions' }).getByRole('option');
    await expect(options.filter({ hasText: /Boston/ }).first()).toBeVisible({ timeout: 20_000 });
    const index = (await options.allInnerTexts()).findIndex((text) => /Boston/.test(text));
    for (let step = 0; step <= index; step++) await field.press('ArrowDown');
    await field.press('Enter');
    await expect(delivery.getByRole('button', { name: 'Change delivery address' })).toBeVisible({
      timeout: 20_000,
    });
    await page.keyboard.press('Escape');

    // Checkout sends her to sign in; she creates an account instead and comes back (S1.1). The
    // dialog that opens there hides the header, so the form is filled here rather than through
    // signUp(), which waits for the header's account menu.
    await open(page, '/sign-up?callbackUrl=%2Fcheckout&reason=checkout');
    await page.getByLabel('Name').fill('Maya Lopez');
    await page.getByLabel('Email').fill(uniqueEmail('maya'));
    await page.getByLabel('Password', { exact: true }).fill(newPassword());
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/checkout$/, { timeout: 30_000 });

    // The add dialog opens by itself, with the place she checked; nothing is saved yet.
    const dialog = page.getByRole('dialog', { name: 'Add an address' });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByRole('heading', { name: 'Add an address' })).toBeFocused();
    // One announcement: what to do, then the delivery check, so neither cuts the other off.
    await expect(liveRegion(page)).toHaveText(
      /^Add the apartment and instructions, then save\. We deliver here/,
      { timeout: 20_000 },
    );
    await expect(dialog.getByRole('combobox', { name: 'Address' })).toHaveValue(/Faneuil Hall/);
    await expect(dialog.locator('#delivery-result')).toHaveText(/^We deliver here/, {
      timeout: 20_000,
    });
    const houseNumber = dialog.getByLabel('House number');
    if (await houseNumber.isVisible()) await houseNumber.fill('1');
    await dialog.getByRole('button', { name: 'Save address' }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await expect(page.getByRole('radio', { name: /^Home, default, .*Faneuil Hall/ })).toBeChecked();

    // Once only: a reload doesn't offer it again now that she has an address.
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Confirm and pay' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Add an address' })).toHaveCount(0);
  });

  test('guests are sent to sign in and come back to checkout (S1.1)', async ({ page }) => {
    await open(page, '/checkout');
    await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2Fcheckout&reason=checkout$/);
  });
});
