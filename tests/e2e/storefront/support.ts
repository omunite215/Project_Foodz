import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Page, type TestInfo } from '@playwright/test';

/** The 375 px project; the other storefront project is 1440 px. */
export const isPhone = (testInfo: TestInfo) => testInfo.project.name === 'storefront-375';

/** Opens a page and waits until it is interactive (hydrated, nothing left loading). */
export async function open(page: Page, path: string) {
  const response = await page.goto(path);
  await page.waitForLoadState('networkidle');
  return response;
}

/** WCAG 2.2 A/AA checks on the whole page. */
export async function expectAccessible(page: Page) {
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
