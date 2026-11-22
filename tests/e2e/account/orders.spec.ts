import {
  ACCOUNTS,
  DEMO_PASSWORD,
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  isPhone,
  open,
  SAMPLE_PASSWORD,
  signIn,
  signUp,
  test,
} from './support';
import { addToCart, expectAccessiblePage, openCheckout } from '../checkout-support';

/*
 * Orders, the order page and saved cards from the account (F4 design 3, 4 and 5). Placing orders
 * is covered by the storefront checkout spec; these read what is there.
 */

test.describe('Orders and saved cards', () => {
  test('a new account: no orders yet, no saved cards, keyboard through the account nav (S12.3, D41, D42)', async ({
    page,
  }, testInfo) => {
    await signUp(page);
    await open(page, '/account/orders');
    await expect(page).toHaveTitle('Orders | Foodz');
    await expect(page.getByRole('heading', { level: 1, name: 'Orders' })).toBeVisible();
    await expect(page.getByText('Newest first. Orders in progress stay at the top.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'No orders yet' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Browse the menu' })).toHaveAttribute(
      'href',
      '/menu',
    );
    const nav = page.getByRole('navigation', { name: 'Account' }).filter({ visible: true });
    await expect(nav.getByRole('link', { name: 'Orders' })).toHaveAttribute('aria-current', 'page');
    await expectAccessible(page);
    if (isPhone(testInfo)) await expectNoSidewaysScroll(page);

    // From the nav to Saved cards by keyboard.
    const cards = nav.getByRole('link', { name: 'Saved cards' });
    await cards.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/account\/cards$/);
    await expect(page).toHaveTitle('Saved cards | Foodz');
    await expect(
      page.getByText(
        'We keep only the brand, the last 4 digits and the expiry date. Your full card number stays with our payment provider, Stripe. You can save up to 5.',
      ),
    ).toBeVisible();
    await expect(
      page
        .getByRole('heading', { level: 2, name: 'No saved cards' })
        .or(
          page.getByText(
            "Card payments aren't set up on this computer, so there are no saved cards.",
          ),
        ),
    ).toBeVisible();
    await expectAccessible(page);
    if (isPhone(testInfo)) await expectNoSidewaysScroll(page);

    // The account menu lists Orders second; Saved cards stay out of it (D43).
    await page.getByRole('button', { name: /^Account menu for / }).click();
    await expect(page.getByRole('menuitem')).toHaveText([
      'Account',
      'Orders',
      'Favorites',
      'Addresses',
      'Sign out',
    ]);
  });

  test('an order id that is not hers, or made up, answers the same 404 (S11.6)', async ({
    page,
  }) => {
    await signUp(page);
    for (const id of ['00000000-0000-4000-8000-000000000000', '1042', 'S1001']) {
      const response = await open(page, `/orders/${id}`);
      expect(response?.status()).toBe(404);
      await expect(page).toHaveTitle('Order not found | Foodz');
      await expect(page.getByRole('heading', { level: 1, name: 'Order not found' })).toBeVisible();
      await expect(
        page.getByText('Check the link, or find the order in your orders.'),
      ).toBeVisible();
    }
    await expect(page.getByRole('link', { name: 'Your orders' })).toHaveAttribute(
      'href',
      '/account/orders',
    );
    await expectAccessible(page);
  });

  test("Priya's past order is listed and its page explains it (S11.1, S12.1)", async ({
    page,
  }, testInfo) => {
    test.skip(!SAMPLE_PASSWORD, 'Needs the sample customers password (E2E_SEED_OUTPUT).');
    await signIn(page, ACCOUNTS.second, SAMPLE_PASSWORD);
    await open(page, '/account/orders');
    const sample = page.getByRole('link', { name: /^Order S1001\s*,\s*Delivered\s*,/ });
    await expect(sample).toBeVisible();
    await expectAccessible(page);
    if (isPhone(testInfo)) await expectNoSidewaysScroll(page);

    await sample.click();
    await expect(page).toHaveTitle('Order S1001 | Foodz');
    await expect(page.getByRole('heading', { level: 1, name: 'Order delivered' })).toBeVisible();
    // A revisit shows the still check, never the animation (S11.2).
    await expect(page.locator('[data-success-check]')).toBeVisible();
    await expect(page.locator('[data-success-animation]')).toHaveCount(0);
    const receipt = page.getByRole('region', { name: 'Receipt' });
    await expect(receipt.getByText(/^Placed \w+, \w+ \d+ at /)).toBeVisible();
    await expect(receipt.getByText('Promo · WELCOME10')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Delivery' })).toContainText(
      'Delivering to Work, 1 Faneuil Hall Square',
    );
    await expect(page.getByRole('button', { name: 'Copy order number S1001' })).toBeVisible();
    await expect(page.getByRole('link', { name: '(617) 555-0142' })).toHaveAttribute(
      'href',
      'tel:+16175550142',
    );
    await expectAccessible(page);
    if (isPhone(testInfo)) await expectNoSidewaysScroll(page);
  });

  test('the demo account sees checkout but places nothing, and keeps no cards (S1.4, U3)', async ({
    page,
  }) => {
    test.skip(!DEMO_PASSWORD, 'Needs the demo password from .env.');
    await signIn(page, ACCOUNTS.demo, DEMO_PASSWORD);
    await open(page, '/account/cards');
    await expect(page.getByText("The demo account can't save cards.")).toBeVisible();
    await expectAccessible(page);

    await addToCart(page, 'kimchi');
    await openCheckout(page);
    const gate = page.locator('#pay-gate');
    await expect(gate).toContainText(
      "Demo accounts can't place orders. Create your own account to try checkout with Stripe test cards.",
    );
    await expect(gate.getByRole('button', { name: 'Create an account' })).toBeVisible();
    await expect(
      page.locator('[data-pay-bar]').getByRole('button', { name: /^(Pay|Place order)/ }),
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add a new address' })).toHaveCount(0);
    await expectAccessiblePage(page);

    // "Create an account" signs the demo out and keeps this device's cart (D29).
    await gate.getByRole('button', { name: 'Create an account' }).click();
    await expect(page).toHaveURL(/\/sign-up\?callbackUrl=%2Fcheckout&reason=checkout$/, {
      timeout: 20_000,
    });
    await expect(
      page.locator('header').getByRole('button', { name: 'Cart, 1 item', includeHidden: true }),
    ).toBeVisible();
  });

  test('an unconfirmed email fills checkout in, but the gate replaces the button (S1.3)', async ({
    page,
  }) => {
    test.skip(!SAMPLE_PASSWORD, 'Needs the sample customers password (E2E_SEED_OUTPUT).');
    await signIn(page, ACCOUNTS.unconfirmed, SAMPLE_PASSWORD);
    await addToCart(page, 'kimchi');
    await openCheckout(page);
    const gate = page.locator('#pay-gate');
    await expect(gate).toContainText(
      `Confirm your email to place your order. We sent a link to ${ACCOUNTS.unconfirmed}.`,
    );
    await expect(gate.getByRole('button', { name: 'Resend link' })).toBeVisible();
    await expect(page.getByLabel('Name for the order')).toBeEditable();
    await expectAccessiblePage(page);
  });
});
