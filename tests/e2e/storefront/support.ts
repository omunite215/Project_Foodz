import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { settleAnimations } from '../settle';

/** The 375 px project; the other storefront project is 1440 px. */
export const isPhone = (testInfo: TestInfo) => testInfo.project.name === 'storefront-375';

/** Opens a page and waits until it is interactive (hydrated, nothing left loading). */
export async function open(page: Page, path: string) {
  const response = await page.goto(path);
  await page.waitForLoadState('networkidle');
  // Set by the root providers once the page has hydrated (a busy machine can lag behind network quiet).
  await page.locator('html[data-hydrated]').waitFor({ state: 'attached', timeout: 20_000 });
  return response;
}

/** WCAG 2.2 A/AA checks on the whole page. */
export async function expectAccessible(page: Page) {
  await settleAnimations(page);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const summary = results.violations.map(
    (violation) =>
      `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
  );
  expect(summary).toEqual([]);
}

/** Nothing wider than the screen (carousels clip their own overflow). */
export async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** The text the site's polite live region last announced. */
export const liveRegion = (page: Page) =>
  page.locator('output[aria-live="polite"][aria-atomic="true"]');

/** The cart as saved in the browser. */
export async function savedCart(page: Page): Promise<Record<string, unknown>[]> {
  const raw = await page.evaluate(() => localStorage.getItem('foodz.cart.v1'));
  if (!raw) return [];
  const saved: Record<string, { data: Record<string, unknown> }> = JSON.parse(raw);
  return Object.values(saved).map((entry) => entry.data);
}

// ------------------------------------------------------------------ the cart (F3)

/**
 * The header's cart button ("Cart, 2 items"). While a dialog is open the page behind it is
 * hidden from assistive technology, so this also finds it then.
 */
export const cartButton = (page: Page) =>
  page.locator('header').getByRole('button', { name: /^Cart(,|$)/, includeHidden: true });

export const cartDialog = (page: Page) => page.getByRole('dialog', { name: 'Your cart' });

/** Adds one of a dish from its page, as a customer would, and waits for the header to count it. */
export async function addDish(page: Page, slug: string) {
  await open(page, `/menu/${slug}`);
  const before = await cartButton(page).getAttribute('aria-label');
  await page
    .locator('main')
    .getByRole('button', { name: /^Add to cart/ })
    .click();
  await expect(page.locator('main').getByText('Added to your cart.')).toBeVisible({
    timeout: 10_000,
  });
  await expect(cartButton(page)).not.toHaveAccessibleName(before ?? 'Cart, empty');
}

/** Opens the cart from the header and waits for its first total. */
export async function openCart(page: Page) {
  await cartButton(page).click();
  const dialog = cartDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

/** The value next to a label in the cart's price details ("Subtotal" gives "$47.97"). */
export const priceValue = (dialog: Locator, label: string | RegExp) =>
  dialog
    .locator('dl > div')
    .filter({ has: dialog.page().locator('dt', { hasText: label }) })
    .locator('dd');

/** The total row in the cart's footer. */
export const totalRow = (dialog: Locator) => dialog.locator('[data-total-row]');
