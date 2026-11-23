import {
  ACCOUNTS,
  expect,
  expectNoAxeViolations,
  isPhone,
  open,
  SAMPLE_PASSWORD,
  signInStaff,
  STAFF,
  test,
} from './support';
import { signIn } from '../account/support';

/*
 * The /admin shell (F5 design 1.1, A1, A13.2): who gets in, which frame, and the gates.
 */

test.describe('who may enter /admin (A1.2 to A1.5)', () => {
  test('a guest signs in first, then comes back', async ({ page }) => {
    await open(page, '/admin/orders');
    await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2Fadmin%2Forders/);
  });

  test('a customer gets the storefront 404, with no hint of staff tools', async ({ page }) => {
    test.skip(!SAMPLE_PASSWORD, 'Needs the sample password (E2E_SEED_OUTPUT).');
    await signIn(page, ACCOUNTS.second, SAMPLE_PASSWORD);
    const response = await open(page, '/admin/orders');
    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole('heading', { level: 1, name: "We couldn't find that page" }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Foodz home' })).toBeVisible();
  });

  test('staff without two-factor see the gate on every address', async ({ page }) => {
    await signInStaff(page, STAFF.noFactor, '/admin/orders');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Two-factor sign-in needed' }),
    ).toBeVisible();
    await expect(page).toHaveTitle('Two-factor sign-in needed | Foodz Admin');
    await expect(page.getByRole('article')).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('a content editor has nothing yet, and no access to the board', async ({ page }) => {
    await signInStaff(page, STAFF.editor);
    await expect(page.getByRole('heading', { level: 1, name: 'Nothing here yet' })).toBeVisible();
    await expectNoAxeViolations(page);
    await open(page, '/admin/orders');
    await expect(
      page.getByRole('heading', { level: 1, name: "You don't have access to this page" }),
    ).toBeVisible();
    await expect(page).toHaveTitle('No access | Foodz Admin');
  });
});

test.describe('frames (A1.6, A16.1)', () => {
  test('the kitchen gets the top bar only, with a logo that is not a link', async ({ page }) => {
    await signInStaff(page, STAFF.kitchen);
    await expect(page).toHaveURL(/\/admin\/orders/);
    await expect(page.getByRole('navigation', { name: 'Staff' })).toHaveCount(0);
    await expect(page.getByRole('banner').getByRole('img', { name: 'Foodz' })).toBeVisible();
    await expect(page.getByRole('banner').getByRole('link', { name: /Foodz/ })).toHaveCount(0);
    // No storefront chrome under /admin (design 1.1).
    await expect(page.getByRole('contentinfo')).toHaveCount(0);
    await page.getByRole('button', { name: /^Account menu for Alex Kim/ }).click();
    await expect(page.getByRole('menuitem')).toHaveText(['Sign out']);
  });

  test('support gets the sidebar listing only the order board', async ({ page }, testInfo) => {
    await signInStaff(page, STAFF.support);
    if (isPhone(testInfo)) {
      await page.getByRole('button', { name: 'Open menu' }).click();
    }
    const nav = page.getByRole('navigation', { name: 'Staff' });
    await expect(nav.getByRole('link')).toHaveCount(1);
    await expect(nav.getByRole('link', { name: 'Order board' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('staff see "Staff tools" in the storefront account menu (A1.8)', async ({ page }) => {
    await signInStaff(page, STAFF.support);
    await open(page, '/menu');
    await page.getByRole('button', { name: /^Account menu for / }).click();
    await expect(page.getByRole('menuitem', { name: 'Staff tools' })).toBeVisible();
  });
});
