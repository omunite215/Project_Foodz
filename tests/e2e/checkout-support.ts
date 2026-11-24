import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Locator, type Page } from '@playwright/test';
import { Client } from 'pg';
import { open, signUp } from './account/support';
import { settleBeforeScan } from './settle';

/*
 * Helpers for the F4 checkout, order and saved-card specs. Each test orders as a fresh customer,
 * so one account's place-order limit (10 an hour) never spills into another test.
 *
 * The email confirmation is set straight in the local test database: the local job runner only
 * delivers emails for the main development server, never for a second test server.
 */

/** Marks a new account's email as confirmed, as its confirm link would. */
export async function confirmEmail(email: string) {
  const client = new Client({
    connectionString: process.env.DATABASE_MIGRATOR_URL ?? process.env.DATABASE_URL,
  });
  await client.connect();
  try {
    await client.query('UPDATE users SET email_verified = true WHERE email = $1', [email]);
  } finally {
    await client.end();
  }
}

/** A new customer with a confirmed email, signed in on this page. */
export async function confirmedCustomer(page: Page) {
  const account = await signUp(page);
  await confirmEmail(account.email);
  return account;
}

/**
 * Picks an address by keyboard from the live suggestions (the address form's own search), and
 * fills a house number when the pick has none.
 */
export async function pickAddress(scope: Page | Locator, query: string, town: RegExp) {
  const field = scope.getByRole('combobox', { name: 'Address' });
  await field.fill('');
  await field.pressSequentially(query, { delay: 25 });
  const page = 'page' in scope ? scope.page() : scope;
  const options = page.getByRole('listbox', { name: 'Address suggestions' }).getByRole('option');
  await expect(options.filter({ hasText: town }).first()).toBeVisible({ timeout: 20_000 });
  const index = (await options.allInnerTexts()).findIndex((text) => town.test(text));
  for (let step = 0; step <= index; step++) await field.press('ArrowDown');
  await field.press('Enter');
  await expect(page.getByRole('listbox', { name: 'Address suggestions' })).toBeHidden();
  const houseNumber = scope.getByLabel('House number');
  if (await houseNumber.isVisible()) await houseNumber.fill('1');
}

/** Saves "1 Faneuil Hall Square" (1.3 km from the kitchen) in the address book. */
export async function saveWorkAddress(page: Page) {
  await open(page, '/account/addresses/new');
  await pickAddress(page, '1 Faneuil Hall Square Boston', /Boston/);
  await expect(page.locator('#delivery-result')).toHaveText(/^We deliver here/, {
    timeout: 20_000,
  });
  await page.getByRole('button', { name: 'Save address' }).click();
  await expect(page).toHaveURL(/\/account\/addresses$/, { timeout: 20_000 });
}

/** Puts one dish in the cart from its page and waits for the header to count it. */
export async function addToCart(page: Page, slug: string) {
  await open(page, `/menu/${slug}`);
  const bag = page
    .locator('header')
    .getByRole('button', { name: /^Cart(,|$)/, includeHidden: true });
  const before = await bag.getAttribute('aria-label');
  await page
    .locator('main')
    .getByRole('button', { name: /^Add to cart/ })
    .click();
  await expect(bag).not.toHaveAccessibleName(before ?? 'Cart, empty', { timeout: 10_000 });
}

/** The pay button (its name carries the amount). */
export const payButton = (page: Page) =>
  page.locator('[data-pay-bar]').getByRole('button', { name: /^(Pay|Place order)/ });

/**
 * Opens checkout and waits until its scripts run (the pay button is no longer disabled). Stripe's
 * frames keep a connection open, so the network never goes quiet on this page.
 */
export async function openCheckout(page: Page) {
  await page.goto('/checkout');
  await expect(page.getByRole('heading', { level: 1, name: 'Confirm and pay' })).toBeVisible();
  await expect(
    page.locator('[data-pay-bar] button:not([disabled]), #pay-gate, #pay-status').first(),
  ).toBeVisible({ timeout: 20_000 });
}

/** Fills the three Stripe card fields (they live in Stripe's frames). */
export async function fillCard(page: Page, number: string, expiry = '1234', cvc = '123') {
  const field = (name: string) => page.frameLocator(`[data-stripe-field="${name}"] iframe`).first();
  const numberInput = field('cardNumber').locator('input[name="cardnumber"]');
  await expect(numberInput).toBeVisible({ timeout: 30_000 });
  await numberInput.click();
  await numberInput.pressSequentially(number, { delay: 15 });
  await field('cardExpiry')
    .locator('input[name="exp-date"]')
    .pressSequentially(expiry, { delay: 15 });
  await field('cardCvc').locator('input[name="cvc"]').pressSequentially(cvc, { delay: 15 });
  // Leave the card fields, as a phone's "Done" would: the pinned pay bar comes back (D5).
  await page.keyboard.press('Tab');
}

/** Waits for the card form to finish loading (the button stops saying so). */
export async function cardFormReady(page: Page) {
  await expect(page.getByRole('button', { name: 'Loading card form…' })).toHaveCount(0, {
    timeout: 30_000,
  });
}

/** Presses "Complete" or "Fail" on Stripe's test bank screen (3-D Secure). */
export async function answerBankCheck(page: Page, answer: 'Complete' | 'Fail') {
  const name = new RegExp(`^${answer}( authentication)?$`, 'i');
  await expect
    .poll(
      async () => {
        for (const frame of page.frames()) {
          if ((await frame.getByRole('button', { name }).count()) > 0) return true;
        }
        return false;
      },
      { timeout: 45_000 },
    )
    .toBe(true);
  for (const frame of page.frames()) {
    const button = frame.getByRole('button', { name });
    if ((await button.count()) > 0) {
      await button.first().click();
      return;
    }
  }
}

/**
 * True when Stripe test mode is set up here (both keys in the environment, as in a local .env)
 * and Stripe's script can be fetched. CI has no Stripe keys, so the card tests skip there; the
 * card paths are covered by the integration tests against a fake Stripe.
 */
export async function stripeReachable(): Promise<boolean> {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
    return false;
  try {
    const response = await fetch('https://js.stripe.com/endive/stripe.js', {
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * WCAG 2.2 A/AA on a page with Stripe's card fields. Stripe adds its own hidden autofill input
 * next to each frame (`__PrivateStripeElement-input`); it isn't ours to change, so it alone is
 * left out. Everything else on the page is checked.
 */
export async function expectAccessiblePage(page: Page) {
  // Colour transitions that are still running would be measured half-way (buttons turning from
  // blocked to ready).
  await settleBeforeScan(page);
  // Figures dim to 75 % while a new total is on its way (F3 2.18); a quote refreshed on the
  // minute or on focus can land mid-check, so measure them settled.
  await expect(page.locator('#main .opacity-75')).toHaveCount(0, { timeout: 15_000 });
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .exclude('.__PrivateStripeElement-input')
    .analyze();
  const summary = results.violations.map(
    (violation) =>
      `${violation.id}: ${violation.nodes
        .map((node) => `${node.target.join(' ')} (${node.failureSummary ?? ''})`)
        .join(', ')}`,
  );
  expect(summary).toEqual([]);
}

/** Chooses a card-style radio (address, tip, payment method) by pressing its visible card. */
export async function choose(page: Page, name: string | RegExp) {
  const radio = page.getByRole('radio', { name });
  await page.locator('label').filter({ has: radio }).first().click();
  await expect(radio).toBeChecked();
}
