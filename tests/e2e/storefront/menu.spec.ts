import { expect, test } from '@playwright/test';
import { expectAccessible, expectNoSidewaysScroll, open } from './support';

const tab = (name: string) => ({ name: new RegExp(`^${name}, \\d+ dish`) });

test.describe('Menu', () => {
  test("shows today's specials above the tabs, with counts and every dish (S2.1)", async ({
    page,
  }) => {
    await open(page, '/menu');
    await expect(page).toHaveTitle('Menu | Foodz');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Our menu');

    const specials = page.getByRole('region', { name: "Today's specials" });
    await expect(specials.getByRole('link')).toHaveCount(3);
    for (const name of ['Gimbap', 'Kimchi', 'Korean BBQ']) {
      await expect(specials.getByRole('link', { name: new RegExp(`^${name},`) })).toBeVisible();
    }
    await expect(specials.getByRole('link', { name: /see specials/i })).toHaveCount(0);

    const specialsTop = await specials.evaluate((element) => element.getBoundingClientRect().top);
    const tabsTop = await page
      .getByRole('tablist', { name: 'Cuisine' })
      .evaluate((element) => element.getBoundingClientRect().top);
    expect(specialsTop).toBeLessThan(tabsTop);

    await expect(page.getByRole('tab', { name: 'Korean, 12 dishes' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('tab', { name: 'Thai, 6 dishes' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Vietnamese, 6 dishes' })).toBeVisible();

    const panel = page.getByRole('tabpanel');
    await expect(panel.getByRole('link')).toHaveCount(12);
    await page.getByRole('tab', tab('Thai')).click();
    await expect(page.getByRole('tabpanel').getByRole('link')).toHaveCount(6);
    await page.getByRole('tab', tab('Vietnamese')).click();
    await expect(page.getByRole('tabpanel').getByRole('link')).toHaveCount(6);
    await expectNoSidewaysScroll(page);
  });

  test('keeps the tab in the address; unknown values show Korean (S2.3)', async ({ page }) => {
    await open(page, '/menu?cuisine=thai');
    await expect(page.getByRole('tab', tab('Thai'))).toHaveAttribute('aria-selected', 'true');

    await page.getByRole('tab', tab('Vietnamese')).click();
    await expect(page).toHaveURL(/\/menu\?cuisine=vietnamese$/);
    await page.reload();
    await expect(page.getByRole('tab', tab('Vietnamese'))).toHaveAttribute('aria-selected', 'true');

    const response = await open(page, '/menu?cuisine=pizza');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('tab', tab('Korean'))).toHaveAttribute('aria-selected', 'true');
  });

  test('the selected tab keeps its white label under the pointer (S8.9)', async ({ page }) => {
    await open(page, '/menu?cuisine=thai');
    const thai = page.getByRole('tab', tab('Thai'));
    await thai.hover();
    // White on the brand green (4.8:1); the hover colour of other tabs would drop to about 3:1.
    await expect
      .poll(() => thai.evaluate((element) => getComputedStyle(element).color))
      .toBe('rgb(255, 255, 255)');
  });

  test('tabs work from the keyboard as one Tab stop (S8.5)', async ({ page }) => {
    await open(page, '/menu');
    const korean = page.getByRole('tab', tab('Korean'));
    await korean.focus();
    await page.keyboard.press('ArrowRight');
    const thai = page.getByRole('tab', tab('Thai'));
    await expect(thai).toBeFocused();
    await expect(thai).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/cuisine=thai/);
    await page.keyboard.press('End');
    await expect(page.getByRole('tab', tab('Vietnamese'))).toBeFocused();

    // From the tabs, Tab goes straight to the first dish card.
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('href'));
    expect(focused).toMatch(/^\/menu\/[a-z0-9-]+$/);
  });

  test('dish cards are one link each, with price, rating and the sold-out dish last (S2.5, S2.6, S4.1)', async ({
    page,
  }) => {
    await open(page, '/menu');
    const panel = page.getByRole('tabpanel');

    const bulgogi = panel.getByRole('link', { name: /^Bulgogi,/ });
    await expect(bulgogi).toHaveAccessibleName('Bulgogi, $22.99, rated 4.4 out of 5, 54 reviews');
    await expect(bulgogi).toHaveAttribute('href', '/menu/bulgogi');
    await expect(bulgogi.locator('a, button')).toHaveCount(0);
    await expect(
      panel.getByRole('link', { name: /^Gimbap, Special, \$12\.99, rated/ }),
    ).toBeVisible();

    const names = await panel
      .getByRole('link')
      .evaluateAll((links) =>
        links.map((link) => link.querySelector('.sr-only')?.textContent ?? ''),
      );
    expect(names.at(-1)).toMatch(/^Naengmyeon, \$\d+\.\d\d, Sold out today, rated/);
    const soldOut = panel.getByRole('link', { name: /^Naengmyeon,/ });
    await expect(soldOut.getByText('Sold out today').first()).toBeVisible();
    await expect(soldOut.getByText('Order now')).toHaveCount(0);
    for (const label of names) expect(label).toMatch(/\$\d+\.\d\d/);

    // The review count stays readable on phones.
    const fontSize = await bulgogi
      .getByText('4.4 · 54 reviews')
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(14);
  });

  test('back from a dish returns to the same tab and scroll position (S2.4)', async ({ page }) => {
    await open(page, '/menu?cuisine=thai');
    const padThai = page.getByRole('tabpanel').getByRole('link', { name: /^Pad Thai,/ });
    await padThai.scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 150);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200);

    // Playwright's click may scroll the link back into view first, so the position to come back
    // to is the one at the moment of the click. Navigation stays client-side, so it survives.
    const scrollAtNextClick = async () => {
      await page.evaluate(() => {
        document.addEventListener(
          'click',
          () => document.documentElement.setAttribute('data-test-scroll', String(window.scrollY)),
          { capture: true, once: true },
        );
      });
    };
    const scrolledAtClick = async () =>
      Number(await page.evaluate(() => document.documentElement.dataset.testScroll));

    await scrollAtNextClick();
    await padThai.click();
    await expect(page).toHaveURL(/\/menu\/pad-thai$/);
    const scrolled = await scrolledAtClick();
    expect(scrolled).toBeGreaterThan(200);
    await page.goBack();
    await expect(page).toHaveURL(/\/menu\?cuisine=thai$/);
    await expect(page.getByRole('tab', tab('Thai'))).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrolled - 120);
    // Keyboard users continue from the dish they opened, not from the top of the page.
    await expect(
      page.getByRole('tabpanel').getByRole('link', { name: /^Pad Thai,/ }),
    ).toBeFocused();

    // The page's own "Go back" does the same.
    await scrollAtNextClick();
    await page
      .getByRole('tabpanel')
      .getByRole('link', { name: /^Pad Thai,/ })
      .click();
    await expect(page).toHaveURL(/\/menu\/pad-thai$/);
    const scrolledAgain = await scrolledAtClick();
    await page.getByRole('link', { name: 'Go back' }).click();
    await expect(page).toHaveURL(/\/menu\?cuisine=thai$/);
    await expect(page.getByRole('tab', tab('Thai'))).toHaveAttribute('aria-selected', 'true');
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(scrolledAgain - 120);
  });

  test('shows a skeleton with one label while a slow menu loads (S7.3)', async ({ page }) => {
    // The link prefetches the menu's loading shell: the route down to loading.tsx, none of the
    // dishes. The click waits for it, as a customer who has had the page open a moment has it.
    // On a busy machine the page can hydrate, and the test click, before the prefetch lands, and
    // a click to a route the router has not seen yet shows nothing until the server answers.
    // The menu itself is held back until the skeleton has been checked: a slow menu by
    // construction, not by timing.
    const menuUrl = /\/menu(\?|$)/;
    const shellPrefetched = page.waitForResponse(
      async (response) =>
        menuUrl.test(response.url()) &&
        Boolean(response.request().headers()['next-router-prefetch']) &&
        (await response.text().catch(() => '')).includes('Loading menu'),
    );
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let heldRequests = 0;
    await page.route(menuUrl, async (route) => {
      if (route.request().headers()['next-router-prefetch']) return route.continue();
      heldRequests += 1;
      await held;
      return route.continue();
    });
    await open(page, '/');
    // Only the skeleton is prefetched, so a customer with a warm cache still sees it.
    expect(await (await shellPrefetched).text()).not.toContain('Bulgogi');
    await page
      .locator('#hero-title')
      .locator('..')
      .getByRole('link', { name: 'Order now' })
      .click();
    await expect.poll(() => heldRequests).toBeGreaterThan(0);
    const busy = page.locator('main [aria-busy="true"]');
    await expect(busy).toBeVisible();
    await expect(busy.locator('output')).toHaveText('Loading menu');
    release?.();
    await expect(page.getByRole('heading', { level: 1, name: 'Our menu' })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('has no accessibility violations', async ({ page }) => {
    await open(page, '/menu');
    await expectAccessible(page);
  });
});
