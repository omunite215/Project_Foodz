import {
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  isPhone,
  open,
  signUp,
  test,
  watchConsole,
} from './support';

const PAGES = [
  { path: '/account', title: 'Your account | Foodz', h1: 'Your account' },
  { path: '/account/addresses', title: 'Addresses | Foodz', h1: 'Addresses' },
  { path: '/account/addresses/new', title: 'Add an address | Foodz', h1: 'Add an address' },
  { path: '/account/security', title: 'Security | Foodz', h1: 'Security' },
  { path: '/account/privacy', title: 'Privacy and data | Foodz', h1: 'Privacy and data' },
  {
    path: '/account/privacy/delete',
    title: 'Delete your account | Foodz',
    h1: 'Delete your account',
  },
] as const;

test.describe('Account pages for everyone (S7)', () => {
  test('each page has one h1, its own title, passes axe, fits the screen and logs no errors', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const problems = watchConsole(page);
    await signUp(page);
    for (const { path, title, h1 } of PAGES) {
      const response = await open(page, path);
      expect(response?.headers()['cache-control'], path).toContain('no-store');
      await expect(page).toHaveTitle(title);
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.getByRole('heading', { level: 1, name: h1 })).toBeVisible();
      await expectAccessible(page);
      await expectNoSidewaysScroll(page);
    }
    for (const path of ['/terms', '/privacy']) {
      await open(page, path);
      await expect(page.locator('h1')).toHaveCount(1);
      await expectAccessible(page);
    }
    await expect(page).toHaveTitle('Privacy Policy | Foodz');
    expect(problems).toEqual([]);
  });

  test('the account navigation fits each width and marks the current page (design 4.1)', async ({
    page,
  }, testInfo) => {
    await signUp(page);
    await open(page, '/account/security');
    const nav = page.getByRole('navigation', { name: 'Account' });
    await expect(nav.getByRole('link', { name: /^Security$/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    for (const link of await nav.getByRole('link').all()) {
      const box = await link.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    if (isPhone(testInfo)) {
      // Sub-pages show their own way back instead of the bar.
      await open(page, '/account/privacy/delete');
      await expect(page.getByRole('navigation', { name: 'Account' })).toBeHidden();
      await expect(page.getByRole('link', { name: 'Back to privacy and data' })).toBeVisible();
    }
  });

  test('with reduced motion, menus and dialogs appear without moving (S7.11)', async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signUp(page);
    await page.getByRole('button', { name: /^Account menu for / }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    expect(await menu.evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
    await page.keyboard.press('Escape');

    await open(page, '/account/addresses/new');
    const skeletons = page.locator('.animate-skeleton');
    for (const skeleton of await skeletons.all()) {
      expect(await skeleton.evaluate((element) => getComputedStyle(element).animationName)).toBe(
        'none',
      );
    }

    if (isPhone(testInfo)) {
      // The footer's groups fold on phones; one opens at once, without its fade.
      const footer = page.getByRole('navigation', { name: 'Footer' });
      await footer.getByRole('button').first().click();
      const group = footer.getByRole('region').first();
      await expect(group).toBeVisible();
      expect(await group.evaluate((element) => getComputedStyle(element).animationName)).toBe(
        'none',
      );
    }
  });
});
