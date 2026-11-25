import {
  ACCOUNTS,
  codeFor,
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
    await expect(page.getByRole('banner').getByRole('link', { name: 'Foodz home' })).toBeVisible();
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

  test('staff without two-factor get the gate at /admin too, with the admin title', async ({
    page,
  }) => {
    await signInStaff(page, STAFF.noFactor, '/admin');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Two-factor sign-in needed' }),
    ).toBeVisible();
    await expect(page).toHaveTitle('Two-factor sign-in needed | Foodz Admin');
  });

  test('a content editor has nothing yet, and no access to the board', async ({ page }) => {
    await signInStaff(page, STAFF.editor);
    await expect(page.getByRole('heading', { level: 1, name: 'Nothing here yet' })).toBeVisible();
    await expect(page).toHaveTitle('Staff tools | Foodz Admin');
    // No screens yet, so no sidebar and no menu button (D3).
    await expect(page.getByRole('navigation', { name: 'Staff' })).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /^(Open menu|Collapse sidebar|Expand sidebar)$/ }),
    ).toHaveCount(0);
    await expect(page.getByRole('banner').getByRole('link', { name: 'Foodz home' })).toBeVisible();
    await expectNoAxeViolations(page);
    await open(page, '/admin/orders');
    await expect(
      page.getByRole('heading', { level: 1, name: "You don't have access to this page" }),
    ).toBeVisible();
    await expect(page).toHaveTitle('No access | Foodz Admin');
  });
});

test.describe('where staff land (A1.1)', () => {
  for (const [who, email] of [
    ['kitchen', STAFF.kitchen],
    ['support', STAFF.support],
  ] as const) {
    test(`${who} signing in with no address lands on the board`, async ({ page }) => {
      await open(page, '/sign-in');
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password', { exact: true }).fill(SAMPLE_PASSWORD);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await page.getByLabel('6-digit code').fill(await codeFor(email));
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page).toHaveURL(/\/admin\/orders$/, { timeout: 30_000 });
      await expect(page.getByRole('heading', { level: 1, name: 'Order board' })).toBeVisible();
    });
  }
});

test.describe('frames (A1.6, A16.1)', () => {
  test('the kitchen gets the top bar only, with a logo that is not a link', async ({
    page,
  }, testInfo) => {
    await signInStaff(page, STAFF.kitchen);
    await expect(page).toHaveURL(/\/admin\/orders/);
    await expect(page.getByRole('navigation', { name: 'Staff' })).toHaveCount(0);
    // Phones leave the logo out: the h1 names the page (design 1.3).
    await expect(page.getByRole('banner').getByRole('img', { name: 'Foodz' })).toHaveCount(
      isPhone(testInfo) ? 0 : 1,
    );
    await expect(page.getByRole('banner').getByRole('link', { name: /Foodz/ })).toHaveCount(0);
    // No storefront chrome under /admin (design 1.1).
    await expect(page.getByRole('contentinfo')).toHaveCount(0);
    // Headless Chrome refuses the screen wake lock just after load, and the notice that says so
    // can land while the menu opens; open it again if it closed.
    await expect(async () => {
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: /^Account menu for Alex Kim/ }).click();
      await expect(page.getByRole('menuitem')).toHaveText(['Sign out'], { timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
  });

  test('support gets the sidebar listing the order board, the live map and partners', async ({
    page,
  }, testInfo) => {
    await signInStaff(page, STAFF.support);
    if (isPhone(testInfo)) {
      await page.getByRole('button', { name: 'Open menu' }).click();
    }
    const nav = page.getByRole('navigation', { name: 'Staff' });
    // F6 A18.1: "Partners" joins the order board for SUPPORT and ADMIN; F8 A46.1: "Live map".
    await expect(nav.getByRole('link')).toHaveCount(3);
    await expect(nav.getByRole('link', { name: 'Live map' })).toBeVisible();
    await expect(nav.getByRole('link', { name: /^Partners/ })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Order board' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    if (isPhone(testInfo)) {
      // Closing the drawer hands focus back to the button that opened it (design 1.2).
      await page.keyboard.press('Escape');
      await expect(nav).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Open menu' })).toBeFocused();
    }
  });

  test('staff see "Staff tools" in the storefront account menu (A1.8)', async ({ page }) => {
    await signInStaff(page, STAFF.support);
    await open(page, '/menu');
    await page.getByRole('button', { name: /^Account menu for / }).click();
    await expect(page.getByRole('menuitem', { name: 'Staff tools' })).toBeVisible();
  });
});
