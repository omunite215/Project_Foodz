import { expect, type Locator, test } from '@playwright/test';
import { isPhone, open } from './support';

async function expectTapTarget(target: Locator) {
  const box = await target.boundingBox();
  expect(box, await target.evaluate((element) => element.outerHTML.slice(0, 80))).not.toBeNull();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
}

test.describe('Shell', () => {
  test('the first Tab stop skips to the content (S8.1)', async ({ page }) => {
    await open(page, '/menu');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('main#main')).toBeFocused();
  });

  test('header and footer sit outside main; the logo reads "Foodz home" (S8.6)', async ({
    page,
  }) => {
    await open(page, '/');
    await expect(page.locator('main header, main footer')).toHaveCount(0);
    await expect(page.locator('body header')).toHaveCount(1);
    await expect(page.locator('body footer')).toHaveCount(1);
    await expect(page.locator('header').getByRole('link', { name: 'Foodz home' })).toBeVisible();
  });

  test('"Menu" stays marked as the current page on a dish page (S8.4)', async ({
    page,
  }, testInfo) => {
    await open(page, '/menu/pad-thai');
    if (isPhone(testInfo)) {
      await page.getByRole('button', { name: 'Menu', exact: true }).click();
    }
    const nav = page.locator('header').getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Menu' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
  });

  test('the phone menu is a real disclosure button (S8.3)', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), 'The burger is only shown below 1024 px.');
    await open(page, '/');
    const burger = page.getByRole('button', { name: 'Menu', exact: true });
    await expect(burger).toHaveAttribute('aria-expanded', 'false');
    await expectTapTarget(burger);

    await burger.focus();
    await page.keyboard.press('Enter');
    await expect(burger).toHaveAttribute('aria-expanded', 'true');
    const panel = page.locator('#mobile-nav');
    await expect(panel.getByRole('link', { name: 'Home' })).toBeFocused();
    await expect(panel.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');

    await page.keyboard.press('Escape');
    await expect(burger).toHaveAttribute('aria-expanded', 'false');
    await expect(burger).toBeFocused();
    await expect(panel).toBeHidden();

    await page.keyboard.press('Space');
    await expect(panel.getByRole('link', { name: 'Home' })).toBeFocused();
    await panel.getByRole('link', { name: 'Menu' }).click();
    await expect(page).toHaveURL(/\/menu$/);
    await expect(panel).toBeHidden();
    await expect(burger).toHaveAttribute('aria-expanded', 'false');
  });

  test('controls are at least 44 px on phones (S8.8)', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), 'Checked at the phone width.');
    await open(page, '/');
    await expectTapTarget(page.getByRole('button', { name: 'Close announcement' }));
    await expectTapTarget(page.getByRole('button', { name: 'Previous offer' }));
    await expectTapTarget(page.getByRole('button', { name: 'Next offer' }));

    await open(page, '/menu');
    for (const tab of await page.getByRole('tab').all()) await expectTapTarget(tab);

    await open(page, '/menu/yangnyeom-chicken');
    await expectTapTarget(page.getByRole('link', { name: 'Go back' }));
    for (const chip of await page
      .getByRole('toolbar', { name: 'Extra flavor' })
      .getByRole('button')
      .all()) {
      await expectTapTarget(chip);
    }
    for (const trigger of await page.locator('footer').getByRole('button').all()) {
      await expectTapTarget(trigger);
    }
  });

  test('carousel arrows move one offer at a time and say where they are (S8.5)', async ({
    page,
  }, testInfo) => {
    test.skip(!isPhone(testInfo), 'From 1024 px the offers sit in one row.');
    await open(page, '/');
    const carousel = page.getByRole('region', { name: "Today's special offers" });
    await expect(carousel.getByText('1 of 3')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Previous offer' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    // Offers out of view cannot be focused.
    await expect(carousel.locator('li[aria-roledescription="slide"][inert]')).toHaveCount(2);

    await page.getByRole('button', { name: 'Next offer' }).click();
    await expect(carousel.getByText('2 of 3')).toBeVisible();
    await expect(carousel.locator('li[aria-label="2 of 3"]')).not.toHaveAttribute('inert');
  });
});
