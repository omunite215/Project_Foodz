import {
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  isPhone,
  liveRegion,
  open,
  signUp,
  test,
} from './support';

const heart = (page: import('@playwright/test').Page, dish: string) =>
  page.locator('main').getByRole('button', { name: `Favorite ${dish}`, exact: true });

/** A server action request: how a heart saves. */
const isSave = (request: { method: () => string; headers: () => Record<string, string> }) =>
  request.method() === 'POST' && Boolean(request.headers()['next-action']);

test.describe('Favorites', () => {
  test('a signed-out heart asks her to sign in, then saves the dish on return (S5.3, B13)', async ({
    page,
  }) => {
    await open(page, '/menu');
    const bulgogi = heart(page, 'Bulgogi');
    await expect(bulgogi).toHaveAttribute('aria-pressed', 'false');
    await bulgogi.click();
    await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2Fmenu&reason=favorite$/);
    // The dish is named by this tab, never by the address.
    await expect(page.getByText('Sign in to save Bulgogi to your favorites.')).toBeVisible();

    // "Create an account" keeps the reason, so the notice follows in sign-up wording.
    await page.getByRole('link', { name: 'Create an account' }).click();
    await expect(page).toHaveURL(/\/sign-up\?callbackUrl=%2Fmenu&reason=favorite$/);
    await expect(
      page.getByText('Create an account to save Bulgogi to your favorites.'),
    ).toBeVisible();
    await signUp(page, { from: page.url().replace(/^https?:\/\/[^/]+/, '') });

    await expect(page).toHaveURL(/\/menu$/);
    await expect(heart(page, 'Bulgogi').first()).toHaveAttribute('aria-pressed', 'true');
    await expect(liveRegion(page)).toHaveText('Bulgogi saved to your favorites.');
  });

  test('a forged link names no dish and saves nothing (B13)', async ({ page }) => {
    await open(page, '/sign-in?callbackUrl=%2Fmenu&reason=favorite');
    await expect(page.getByText('Sign in to save this dish to your favorites.')).toBeVisible();
    await open(page, '/sign-in?reason=<b>free</b>');
    // An unknown reason reads as none: no notice, and nothing from the address on the page.
    await expect(page.getByText(/^Sign in to (check out|use|save)/)).toHaveCount(0);
    await expect(page.getByText('free', { exact: true })).toHaveCount(0);
  });

  test('hearts save at once, the favorites page lists them newest first, and undo works (S5.2, S5.4, S5.6)', async ({
    page,
  }) => {
    await signUp(page);
    await open(page, '/account/favorites');
    await expect(page).toHaveTitle('Favorites | Foodz');
    await expect(page.getByRole('heading', { level: 1, name: 'Favorites' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No favorites yet' })).toBeVisible();
    await expect(page.getByText('Tap the heart on any dish to keep it here.')).toBeVisible();
    await expectAccessible(page);

    await open(page, '/menu');
    await heart(page, 'Bulgogi').click();
    await expect(heart(page, 'Bulgogi')).toHaveAttribute('aria-pressed', 'true');
    await expect(liveRegion(page)).toHaveText('Bulgogi saved to your favorites.');
    await heart(page, 'Kimchi').first().click();
    await expect(liveRegion(page)).toHaveText('Kimchi saved to your favorites.');

    // A quick double tap ends where it started, with no error.
    const gimbap = heart(page, 'Gimbap').first();
    await gimbap.dblclick();
    await expect(gimbap).toHaveAttribute('aria-pressed', 'false');

    await open(page, '/account/favorites');
    const list = page.locator('main').getByRole('list').last();
    await expect(list.locator('h2 > span[aria-hidden]')).toHaveText(['Kimchi', 'Bulgogi']);

    // Server action requests (the hearts' saves) still on their way.
    let savesInFlight = 0;
    page.on('request', (request) => {
      if (isSave(request)) savesInFlight += 1;
    });
    const settled = (request: Parameters<typeof isSave>[0]) => {
      if (isSave(request)) savesInFlight -= 1;
    };
    page.on('requestfinished', settled);
    page.on('requestfailed', settled);

    await heart(page, 'Kimchi').click();
    // The visible notice; the screen-reader announcer may hold the same words for a moment.
    await expect(
      page.locator('[data-slot="alert-description"]', {
        hasText: 'Kimchi removed from your favorites.',
      }),
    ).toBeVisible();
    await expect(list.locator('h2 > span[aria-hidden]')).toHaveText(['Bulgogi']);
    await expect(page.locator('main').getByRole('link', { name: /^Bulgogi,/ })).toBeFocused();
    await page.getByRole('button', { name: 'Undo removing Kimchi' }).click();
    await expect(list.locator('h2 > span[aria-hidden]')).toHaveText(['Kimchi', 'Bulgogi']);
    await expect(heart(page, 'Kimchi')).toBeFocused();
    await expect(liveRegion(page)).toHaveText('Kimchi saved to your favorites.');

    // Saved on the server: still there after a reload. A heart settles 300 ms after the last tap,
    // and on a busy machine its request can take longer than any fixed wait: wait until no save
    // is in flight, then read the server's list until it shows the undo.
    // Quiet for 1.5 s: an Undo's save starts only once the removal's has answered, so a single
    // moment with nothing in flight isn't enough, and a reload would cancel the save.
    let quietChecks = 0;
    await expect
      .poll(
        () => {
          quietChecks = savesInFlight > 0 ? 0 : quietChecks + 1;
          return quietChecks >= 3;
        },
        { timeout: 15_000, intervals: [500] },
      )
      .toBe(true);
    await expect
      .poll(
        async () => {
          await page.reload();
          return list.locator('h2 > span[aria-hidden]').allTextContents();
        },
        { timeout: 20_000, intervals: [500, 1_000, 2_000] },
      )
      .toEqual(['Kimchi', 'Bulgogi']);
    await expectNoSidewaysScroll(page);
    await expectAccessible(page);
  });

  test('the account navigation lists its seven sections (F4 design 1.2)', async ({
    page,
  }, testInfo) => {
    await signUp(page);
    await open(page, '/account');
    const nav = page.getByRole('navigation', { name: 'Account' }).filter({ visible: true });
    await expect(nav.getByRole('link')).toHaveText(
      isPhone(testInfo)
        ? ['Account', 'Orders', 'Favorites', 'Addresses', 'Saved cards', 'Security', 'Privacy']
        : [
            'Account',
            'Orders',
            'Favorites',
            'Addresses',
            'Saved cards',
            'Security',
            'Privacy and data',
          ],
    );
    await nav.getByRole('link', { name: 'Favorites' }).click();
    await expect(page).toHaveURL(/\/account\/favorites$/);
    await expect(nav.getByRole('link', { name: 'Favorites' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});
