import { expect, test } from '@playwright/test';
import {
  expectAccessible,
  expectNoSidewaysScroll,
  isPhone,
  liveRegion,
  open,
  savedCart,
} from './support';

test.describe('Home', () => {
  test('follows the design order with real offers and no placeholder copy (S1.1, S1.2, S1.8)', async ({
    page,
  }) => {
    await open(page, '/');

    await expect(page).toHaveTitle('Foodz');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      "You've Got Questions.We've Got Taste.",
    );
    const sections = await page
      .locator('main h2')
      .evaluateAll((headings) =>
        headings
          .filter((heading) => heading.getClientRects().length > 0)
          .map((heading) => heading.textContent?.trim()),
      );
    expect(sections).toEqual([
      'Korean BBQ weekend',
      "Today's special offers",
      'Meet our kitchen',
      'How we keep your meal delicious',
      'Get the best taste now',
    ]);

    const offers = page.locator('#specials');
    for (const [name, price] of [
      ['Gimbap', '$12.99'],
      ['Kimchi', '$6.99'],
      ['Korean BBQ', '$21.99'],
    ]) {
      await expect(
        offers.getByRole('link', { name: new RegExp(`^${name}, \\${price}, rated`) }).first(),
      ).toBeAttached();
    }

    const text = await page.locator('body').innerText();
    for (const placeholder of [
      '214 Reviews',
      "This text don't have any meaning",
      "but I don't write anything",
      'without lorem isum',
      'Prepair',
      'bext',
      '60 minutes',
      '30 minutes',
    ]) {
      expect(text).not.toContain(placeholder);
    }
    expect(text).toContain('about 45 minutes');
    await expectNoSidewaysScroll(page);
  });

  test('every offer card opens its dish page (S1.3)', async ({ page }, testInfo) => {
    await open(page, '/');
    const offers = page.locator('#specials');
    const card = isPhone(testInfo)
      ? offers.getByRole('link', { name: /^Korean BBQ,/ }).first()
      : offers.getByRole('link', { name: /^Gimbap,/ }).last();

    await card.click();
    await expect(page).toHaveURL(isPhone(testInfo) ? /\/menu\/korean-bbq$/ : /\/menu\/gimbap$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('the campaign shows its code, copies it and opens the Korean tab (S1.4)', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await open(page, '/');

    await expect(page.getByText('$5 off Korean dishes over $25 with code')).toBeVisible();
    const code = page.getByText('KBBQ5', { exact: true });
    await expect(code).toBeVisible();
    // Real text, selected whole with one tap.
    expect(await code.evaluate((element) => getComputedStyle(element).userSelect)).toBe('all');

    await page.getByRole('button', { name: 'Copy code' }).click();
    await expect(page.getByRole('button', { name: 'Code copied' })).toBeVisible();
    await expect(liveRegion(page)).toHaveText('Code copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('KBBQ5');

    const campaign = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Korean BBQ weekend' }) });
    await campaign.getByRole('link', { name: 'Order now' }).click();
    await expect(page).toHaveURL(/\/menu\?cuisine=korean$/);
    await expect(page.getByRole('tab', { name: 'Korean, 12 dishes' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('the announcement bar arrives with the page and stays closed once closed (S1.6)', async ({
    page,
  }) => {
    await open(page, '/');
    const bar = page.getByRole('region', { name: 'Announcement' });
    await expect(bar).toContainText('Free delivery on orders over $30');
    await expect(bar).toContainText('FREEDELIVERY');
    const height = await bar.evaluate((element) => element.getBoundingClientRect().height);
    expect(height).toBeLessThanOrEqual(64);

    await bar.getByRole('button', { name: 'Close announcement' }).click();
    await expect(bar).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('region', { name: 'Announcement' })).toHaveCount(0);
    await open(page, '/menu');
    await expect(page.getByRole('region', { name: 'Announcement' })).toHaveCount(0);
  });

  test('"Order now" in the hero opens the menu (S1.7)', async ({ page }) => {
    await open(page, '/');
    await page
      .locator('#hero-title')
      .locator('..')
      .getByRole('link', { name: 'Order now' })
      .click();
    await expect(page).toHaveURL(/\/menu$/);
  });

  test('the store status and delivery facts come from the settings (S5.1, S5.5)', async ({
    page,
  }) => {
    await open(page, '/');
    const main = page.locator('main');
    await expect(
      main.getByText(/^(Open now · until \d{1,2} (am|pm)|We're closed right now)$/).first(),
    ).toBeVisible();
    await expect(main.getByText('Delivery from')).toBeVisible();
    await expect(main.getByText('$1.99')).toBeVisible();
    await expect(main.getByText('of 88 Harbor Street, Boston')).toBeVisible();

    const footer = page.locator('footer');
    await expect(footer.getByText('Mon–Thu')).toBeVisible();
    await expect(footer.getByText('11 am–10 pm')).toBeVisible();
    await expect(footer.getByText('88 Harbor Street, Boston, MA 02210')).toBeVisible();
  });

  test('after leaving and coming back, the taste picker shows what it holds (S6)', async ({
    page,
  }) => {
    await open(page, '/');
    const form = page
      .locator('form')
      .filter({ has: page.getByRole('heading', { name: "What's your taste?" }) });
    await form.getByLabel(/^Dish 1/).selectOption({ label: 'Gimbap · $12.99' });
    await expect(form.locator('output')).toHaveText('$12.99');

    // A full page load away and Back: the browser must not refill fields the form no longer holds.
    await page.goto('/blog');
    await page.goBack();
    await page.waitForLoadState('networkidle');
    await expect(form.getByLabel(/^Dish 1/)).toHaveValue('');
    await expect(form.locator('output')).toHaveText('$0.00');
  });

  test('the taste picker adds the chosen dishes to the cart (S6)', async ({ page }) => {
    await open(page, '/');
    const form = page
      .locator('form')
      .filter({ has: page.getByRole('heading', { name: "What's your taste?" }) });
    await form.scrollIntoViewIfNeeded();

    // Nothing chosen: the error sits next to the field and focus moves there; nothing is cleared.
    const firstDish = form.getByLabel(/^Dish 1/);
    await expect(firstDish).toHaveValue('');
    await form.getByRole('button', { name: 'Add to cart' }).click();
    await expect(form.getByText('Choose at least one dish')).toBeVisible();
    await expect(firstDish).toBeFocused();
    await expect(firstDish).toHaveAttribute('aria-invalid', 'true');

    // Real prices and only orderable dishes; the subtotal follows the choice.
    await expect(firstDish.locator('option', { hasText: 'Naengmyeon' })).toHaveCount(0);
    await firstDish.selectOption({ label: 'Gimbap · $12.99' });
    await form
      .getByLabel(/^How many/)
      .first()
      .selectOption('2');
    await expect(form.locator('output')).toHaveText('$25.98');
    await expect(form.getByText('Choose at least one dish')).toHaveCount(0);

    // A second row appears in place, can be removed, and loses nothing.
    await form.getByRole('button', { name: 'Add another dish' }).click();
    await expect(form.getByLabel('Dish 2', { exact: true })).toBeFocused();
    await form.getByRole('button', { name: 'Remove dish 2' }).click();
    await expect(form.getByLabel('Dish 2', { exact: true })).toHaveCount(0);
    await expect(firstDish).toHaveValue(/.+/);

    // A double click adds once.
    await form.getByRole('button', { name: 'Add to cart' }).dblclick();
    await expect(form.getByText('2 dishes added to your cart.')).toBeVisible();
    await expect(liveRegion(page)).toContainText('2 dishes added to your cart');
    await expect(page.locator('header').getByText('2 items in your cart')).toBeAttached();
    expect(await savedCart(page)).toMatchObject([{ quantity: 2 }]);
    await expect(page).toHaveURL(/\/$/);
  });

  test('the hero dish holds still under reduced motion (S8.7)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, '/');
    const dish = page.locator('[data-hero-dish]');
    const transforms = () =>
      dish.evaluate((element) => [
        getComputedStyle(element).transform,
        getComputedStyle(element.firstElementChild ?? element).transform,
      ]);

    expect(await transforms()).toEqual(['none', 'none']);
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(700);
    expect(await transforms()).toEqual(['none', 'none']);
    // Content below the fold is simply there, with nothing hidden for a reveal.
    const opacity = await page
      .getByRole('heading', { name: 'How we keep your meal delicious' })
      .evaluate((element) => getComputedStyle(element.closest('div') ?? element).opacity);
    expect(opacity).toBe('1');
  });

  test('with motion allowed, the hero dish turns as the hero scrolls away', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await open(page, '/');
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(1200);
    const turned = await page
      .locator('[data-hero-dish] > div')
      .evaluate((element) => getComputedStyle(element).transform);
    expect(turned).not.toBe('none');
  });

  test('has no accessibility violations', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, '/');
    await expectAccessible(page);
  });
});
