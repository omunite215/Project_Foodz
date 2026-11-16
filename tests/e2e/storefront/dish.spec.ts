import { expect, test } from '@playwright/test';
import { LEGACY_MENU_REDIRECTS } from '../../../server/modules/menu/urls';
import { expectAccessible, expectNoSidewaysScroll, liveRegion, open, savedCart } from './support';

test.describe('Dish page', () => {
  test('tells the price, flavors, prep time and reviews of the dish (S3.1, S3.4, S3.5)', async ({
    page,
  }) => {
    await open(page, '/menu/yangnyeom-chicken');
    await expect(page).toHaveTitle('Yangnyeom Chicken | Foodz');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Yangnyeom Chicken');

    const main = page.locator('main');
    await expect(main.getByText('Korean', { exact: true })).toBeVisible();
    await expect(main.getByText('$21.99', { exact: true })).toBeVisible();
    await expect(main.getByText(/^Ready in about \d+ min$/)).toBeVisible();
    await expect(main.getByText('rated 4.4 out of 5, 70 reviews')).toBeAttached();
    await expect(main.getByRole('heading', { name: 'Description' })).toBeVisible();
    // This dish's own flavors, not a fixed list.
    const flavors = main.getByRole('toolbar', { name: 'Extra flavor' }).getByRole('button');
    await expect(flavors).toHaveText(['Sesame oil', 'Spring onion', 'Toasted sesame', 'Soy sauce']);
    // One photo: no counter and nothing to swipe.
    await expect(main.getByText(/^1\/\d$/)).toHaveCount(0);
    await expect(main.getByRole('button', { name: /photo/i })).toHaveCount(0);
    await expect(main.getByRole('link', { name: 'View all' })).toHaveCount(0);
    await expectNoSidewaysScroll(page);
  });

  test('shows the real time left on its offer, and no badge without one (S3.3)', async ({
    page,
  }) => {
    await open(page, '/menu/yangnyeom-chicken');
    const badge = page.locator('main').getByText(/^Offer Ends in \d+ days?$/);
    await expect(badge).toBeVisible();
    await expect(badge).not.toHaveAttribute('aria-live');

    await open(page, '/menu/jajangmyeon');
    await expect(page.locator('main').getByText(/Ends in/)).toHaveCount(0);
  });

  test('marks only the most ordered dish of its cuisine as a best seller (S3.2)', async ({
    page,
  }) => {
    await open(page, '/menu/tteokbokki');
    await expect(page.locator('main').getByText('Best seller')).toBeVisible();
    await open(page, '/menu/jajangmyeon');
    await expect(page.locator('main').getByText('Best seller')).toHaveCount(0);
  });

  test('adds the dish once, with its flavors and note, and says so (S3.6, S3.7, S3.8)', async ({
    page,
  }) => {
    await open(page, '/menu/yangnyeom-chicken');
    const main = page.locator('main');

    const springOnion = main.getByRole('button', { name: 'Spring onion' });
    await expect(springOnion).toHaveAttribute('aria-pressed', 'false');
    await springOnion.click();
    await expect(springOnion).toHaveAttribute('aria-pressed', 'true');
    const height = await springOnion.evaluate((element) => element.getBoundingClientRect().height);
    expect(height).toBeGreaterThanOrEqual(44);

    const note = main.getByLabel('Note for the kitchen');
    await expect(note).toHaveAttribute('maxlength', '200');
    expect(await note.evaluate((element) => getComputedStyle(element).fontSize)).toBe('16px');
    await note.fill('No sesame, please');
    await expect(main.getByText('17/200')).toBeVisible();

    await main.getByRole('button', { name: /^Add to cart · \$21\.99$/ }).dblclick();
    // Within 1 s on a quiet server; the page adds anyway once the check passes 2 s.
    await expect(main.getByText('Added to your cart.')).toBeVisible({ timeout: 2000 });
    await expect(liveRegion(page)).toHaveText('Yangnyeom Chicken added to your cart.');
    await expect(page.locator('header').getByText('1 item in your cart')).toBeAttached();
    expect(await savedCart(page)).toMatchObject([
      { quantity: 1, flavors: ['Spring onion'], note: 'No sesame, please' },
    ]);
  });

  test('a sold-out dish says so, cannot be added and suggests others (S4.2)', async ({ page }) => {
    await open(page, '/menu/naengmyeon');
    const main = page.locator('main');
    await expect(main.getByText('Sold out today', { exact: true }).first()).toBeVisible();
    await expect(main.getByRole('button', { name: 'Sold out' })).toBeDisabled();
    await expect(main.getByText('Sold out today. Try one of these instead.')).toBeVisible();

    const suggestions = main.getByRole('region', { name: 'More Korean dishes' });
    const links = suggestions.getByRole('link');
    expect(await links.count()).toBeGreaterThan(0);
    expect(await links.count()).toBeLessThanOrEqual(3);
    for (const label of await links.evaluateAll((all) =>
      all.map((link) => link.querySelector('.sr-only')?.textContent ?? ''),
    )) {
      expect(label).not.toContain('Sold out');
    }
  });

  test('an unknown dish answers 404 inside the normal page (S4.4)', async ({ page }) => {
    for (const path of [
      '/menu/does-not-exist',
      '/menu/%00',
      `/menu/${'a'.repeat(300)}`,
      // Below an unknown dish, and below a real one.
      '/menu/korean/does-not-exist',
      '/menu/jajangmyeon/anything',
    ]) {
      const response = await open(page, path);
      expect(response?.status(), path).toBe(404);
      await expect(page).toHaveTitle('Dish not found | Foodz');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        "We couldn't find that dish",
      );
      await expect(page.getByRole('link', { name: 'Back to the menu' })).toHaveAttribute(
        'href',
        '/menu',
      );
      await expect(page.locator('header')).toBeVisible();
      await expect(page.locator('footer')).toBeVisible();
    }

    const response = await page.request.get('/menu/BULGOGI', { maxRedirects: 0 });
    expect([301, 308]).toContain(response.status());
    expect(response.headers().location).toBe('/menu/bulgogi');
  });

  test('every old link moves permanently to its new address, keeping the query (S4.5)', async ({
    request,
  }) => {
    expect(LEGACY_MENU_REDIRECTS).toHaveLength(18);
    for (const { from, to } of LEGACY_MENU_REDIRECTS) {
      const response = await request.get(`${from}?ref=old`, { maxRedirects: 0 });
      expect(response.status(), from).toBe(308);
      const location = new URL(response.headers().location ?? '', 'http://localhost');
      const target = new URL(to, 'http://localhost');
      expect(location.pathname, from).toBe(target.pathname);
      expect(Object.fromEntries(location.searchParams), from).toEqual({
        ...Object.fromEntries(target.searchParams),
        ref: 'old',
      });
    }
  });

  test('old links to dishes that never existed show the not-found page (S4.6)', async ({
    page,
  }) => {
    for (const path of ['/menu/korean/km99', '/menu/thai/km01']) {
      const response = await open(page, path);
      expect(response?.status(), path).toBe(404);
      expect(page.url(), path).toContain(path);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        "We couldn't find that dish",
      );
    }
  });

  test('"Go back" from a shared link opens the dish\'s cuisine tab (S2.4)', async ({ page }) => {
    await open(page, '/menu/pad-thai');
    const back = page.getByRole('link', { name: 'Go back' });
    await expect(back).toHaveAttribute('href', '/menu?cuisine=thai');
    await back.click();
    await expect(page).toHaveURL(/\/menu\?cuisine=thai$/);
    await expect(page.getByRole('tab', { name: 'Thai, 6 dishes' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('has no accessibility violations', async ({ page }) => {
    await open(page, '/menu/yangnyeom-chicken');
    await expectAccessible(page);
    await open(page, '/menu/naengmyeon');
    await expectAccessible(page);
    await open(page, '/menu/does-not-exist');
    await expectAccessible(page);
  });
});
