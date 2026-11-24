import path from 'node:path';
import type { Page } from '@playwright/test';
import {
  expect,
  expectNoAxeViolations,
  open,
  PARTNERS,
  projectOf,
  ROUTE,
  SAMPLE_PASSWORD,
  signInTo,
  test,
} from './support';

/*
 * The partner app (F6 design 1 to 6): the landing, who reaches which screen, the decision
 * screens, the application form, going online and offline, the profile and the dark theme.
 * Flows that change shared state (going online, the demo partner) run in one project only.
 */

/** Design 6.8: within 3 km the map frames the kitchen too; its pin sits inside the map's box. */
async function expectKitchenPinInMap(page: Page) {
  const map = page.locator('.maplibregl-map');
  const pin = map.locator('.maplibregl-marker').first();
  await expect(pin).toBeAttached({ timeout: 20_000 });
  await expect
    .poll(
      async () => {
        const [box, mark] = await Promise.all([map.boundingBox(), pin.boundingBox()]);
        if (!box || !mark) return false;
        return (
          mark.x >= box.x - 1 &&
          mark.y >= box.y - 1 &&
          mark.x + mark.width <= box.x + box.width + 1 &&
          mark.y + mark.height <= box.y + box.height + 1
        );
      },
      { timeout: 15_000 },
    )
    .toBe(true);
}

test.beforeEach(() => {
  test.skip(!SAMPLE_PASSWORD, 'Needs the sample password (E2E_SEED_OUTPUT).');
});

test('the landing and its footer link, for a guest', async ({ page }) => {
  await open(page, '/');
  const footer = page.getByRole('contentinfo');
  // Phones fold the footer's groups (F1): open Help first.
  const help = footer.getByRole('button', { name: 'Help' });
  if (await help.isVisible()) await help.click();
  const footerLink = page
    .getByRole('contentinfo')
    .getByRole('link', { name: 'Deliver with Foodz' });
  await expect(footerLink).toHaveAttribute('href', '/deliver');
  await open(page, '/deliver');
  await expect(page).toHaveTitle('Deliver with Foodz | Foodz');
  await expect(page.getByRole('heading', { level: 1, name: 'Deliver with Foodz' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What you need' })).toBeVisible();
  const apply = page.getByRole('link', { name: 'Apply now' }).first();
  await expect(apply).toHaveAttribute('href', '/sign-in?callbackUrl=%2Fpartner%2Fapply');
  await expect(
    page.getByText("You'll sign in or create a Foodz account first.").first(),
  ).toBeVisible();
  await expectNoAxeViolations(page);
});

test('guests are sent to sign in, and come back to the address they asked for', async ({
  page,
}) => {
  await page.goto('/partner/profile');
  await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2Fpartner%2Fprofile$/);
  await page.goto('/partner/terms');
  await expect(page.getByRole('heading', { level: 1, name: 'Foodz Partner Terms' })).toBeVisible();
});

test('Ana waits on the pending screen, in light and in dark', async ({
  page,
  context,
  baseURL,
}) => {
  await signInTo(page, PARTNERS.ana);
  await expect(page).toHaveTitle('Your application | Foodz Partner');
  await expect(
    page.getByRole('heading', { level: 1, name: "We're checking your application" }),
  ).toBeVisible();
  const sent = page.getByRole('region', { name: 'What you sent' });
  await expect(sent.getByText('Scooter or moped · 7KT 219')).toBeVisible();
  await expect(sent.getByText(/^Driver's license ending 4407 · expires/)).toBeVisible();
  await expect(sent.getByText('(617) 555-…')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit application' })).toBeVisible();
  await expectNoAxeViolations(page);

  // The theme comes from the cookie in the server render (design 0.4, 2.5).
  await context.addCookies([{ name: 'foodz-partner-theme', value: 'dark', url: baseURL ?? '' }]);
  await page.reload();
  await expect(page.locator('.partner')).toHaveClass(/\bdark\b/);
  await expectNoAxeViolations(page);

  // Withdraw asks first, and Keep leaves everything as it was.
  await page.getByRole('button', { name: 'Withdraw application' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Withdraw your application?' });
  await expect(dialog.getByRole('button', { name: 'Keep application' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Keep application' }).click();
  await expect(dialog).toHaveCount(0);
});

test('Kwame reads the message as typed and fixes the application from step 4', async ({ page }) => {
  await signInTo(page, PARTNERS.kwame);
  await expect(
    page.getByRole('heading', { level: 1, name: 'We need one thing from you' }),
  ).toBeVisible();
  await expect(page.getByText(/^The photo of your ID is blurry\./)).toBeVisible();
  await expect(
    page.getByText("Being sent back isn't a rejection.", { exact: false }),
  ).toBeVisible();
  await expectNoAxeViolations(page);
  await page.getByRole('link', { name: 'Fix it' }).click();
  await expect(page).toHaveURL(/\/partner\/apply\?mode=fix&step=4/);
  await expect(page.getByText('Fix your application')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Check and send' })).toBeVisible();
  await expect(page.getByText('What we need:')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
  await expectNoAxeViolations(page);
});

test('Jonas sees the reason and when he can apply again; Victor sees the suspension', async ({
  page,
  browser,
}) => {
  await signInTo(page, PARTNERS.jonas);
  await expect(
    page.getByRole('heading', { level: 1, name: "Your application wasn't approved" }),
  ).toBeVisible();
  await expect(
    page.getByText("We couldn't match the name on your ID to your account name."),
  ).toBeVisible();
  await expect(
    page.getByText(/^You can apply again from \w{3}, \w{3} \d+, \d{4}\.$/),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Apply again' })).toHaveCount(0);
  await expectNoAxeViolations(page);

  // A partner who signs in with no address lands on the partner app (P7.3).
  const other = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  const victor = await other.newPage();
  await open(victor, '/sign-in');
  await victor.getByLabel('Email').fill(PARTNERS.victor);
  await victor.getByLabel('Password', { exact: true }).fill(SAMPLE_PASSWORD);
  await victor.getByRole('button', { name: 'Sign in' }).click();
  await expect(victor).toHaveURL(/\/partner$/, { timeout: 30_000 });
  await expect(
    victor.getByRole('heading', { level: 1, name: 'Your partner account is suspended' }),
  ).toBeVisible();
  await expect(victor.getByText('Repeated late deliveries (test account)')).toBeVisible();
  await expect(victor.getByRole('button', { name: 'Go online' })).toHaveCount(0);
  await expectNoAxeViolations(victor);
  await other.close();
});

test('Mei reapplies: each step checks only its own fields, and the number is never kept', async ({
  page,
}) => {
  await signInTo(page, PARTNERS.mei);
  await page.getByRole('link', { name: 'Apply again' }).click();
  await expect(page).toHaveURL(/\/partner\/apply/);
  await expect(page.getByRole('heading', { level: 1, name: 'About you' })).toBeVisible();
  await expect(page.getByText('Step 1 of 4')).toBeVisible();
  await expectNoAxeViolations(page);

  // Continue with no photo: the field says why and takes focus.
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Add a photo of your face.')).toBeVisible();

  // A typed later step opens the first incomplete one, with no error.
  await page.goto('/partner/apply?step=3');
  await expect(page.getByRole('heading', { level: 1, name: 'About you' })).toBeVisible();
});

test('Diego goes online with his location, sees the idle screen, and goes offline', async ({
  page,
  context,
}, testInfo) => {
  test.skip(projectOf(testInfo) !== 'partner-360', "One project changes Diego's online state.");
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ ...ROUTE.R0, accuracy: 15 });
  await signInTo(page, PARTNERS.diego);
  // Signing in reaches /partner without a new document; the app loads itself once as a partner
  // document, so location is allowed (Permissions-Policy). Wait for that document.
  await open(page, '/partner');
  await expect(page).toHaveTitle('Home | Foodz Partner');
  await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible();
  await expect(page.getByRole('banner').getByText('Offline', { exact: true })).toBeVisible();
  await expectNoAxeViolations(page);

  await page.getByRole('button', { name: 'Go online' }).click();
  await expect(page.getByRole('heading', { name: 'Waiting for orders' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole('banner').getByText('Online', { exact: true })).toBeVisible();
  await expect(page.getByText('At the kitchen')).toBeVisible();
  // He rides two steps along route R: the distance follows each fix (P10.2).
  await context.setGeolocation({ ...ROUTE.R2, accuracy: 15 });
  await expect(page.getByText('0.5 km')).toBeVisible({ timeout: 15_000 });
  await expectKitchenPinInMap(page);
  await expect(page.getByText(/^Location shared · /)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Go offline' })).toBeVisible();
  await expectNoAxeViolations(page);

  // Standing still, with no new fix from the phone, a point still goes every 15 s (P10.3).
  await page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/v1/partner/locations'),
    { timeout: 25_000 },
  );

  // A dead zone: the banner pins, what he rides meanwhile waits, and goes when he's back
  // (P11.1, P11.2). The banners are paragraphs; the live region repeats their words.
  const banner = (text: string) => page.getByRole('paragraph').filter({ hasText: text });
  await context.setOffline(true);
  await expect(banner("No connection. You're still online.")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole('banner').getByText('Online', { exact: true })).toBeVisible();
  await context.setGeolocation({ ...ROUTE.R0, accuracy: 15 });
  await expect(page.getByText('At the kitchen')).toBeVisible({ timeout: 15_000 });
  await context.setOffline(false);
  await expect(banner('Back online. Location sent.')).toBeVisible({ timeout: 15_000 });
  await expect(banner("No connection. You're still online.")).toHaveCount(0);
  // It stays 4 seconds, then the screen is as before.
  await expect(banner('Back online. Location sent.')).toHaveCount(0, { timeout: 10_000 });

  // Profile keeps the status in view; Appearance applies at once.
  await page.getByRole('link', { name: 'Profile' }).last().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Diego Alvarez' })).toBeVisible();
  await expect(page.getByRole('banner').getByText('Online', { exact: true })).toBeVisible();
  await page.getByText('Dark', { exact: true }).click();
  await expect(page.locator('.partner')).toHaveAttribute('data-theme', 'dark');
  await expectNoAxeViolations(page);
  await page.getByText('Light', { exact: true }).click();

  await page.getByRole('link', { name: 'Home' }).click();
  await page.getByRole('button', { name: 'Go offline' }).click();
  await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible();
  await expect(page.getByRole('banner').getByText('Offline', { exact: true })).toBeVisible();
});

test('the location explainer comes before the browser asks', async ({ page }, testInfo) => {
  test.skip(projectOf(testInfo) !== 'partner-360', "One project changes Grace's online state.");
  // The browser hasn't been asked yet (P9.2): the permission reads "prompt".
  await page.addInitScript(() => {
    const query = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (descriptor) =>
      descriptor.name === 'geolocation'
        ? Promise.resolve({ state: 'prompt', onchange: null } as unknown as PermissionStatus)
        : query(descriptor);
  });
  await signInTo(page, PARTNERS.grace);
  await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible();
  await page.getByRole('button', { name: /^Go online/ }).click();
  const sheet = page.getByRole('dialog', { name: "Share your location while you're online" });
  await expect(sheet).toBeVisible();
  await expectNoAxeViolations(page);
  await sheet.getByRole('button', { name: 'Not now' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Go online/ })).toBeFocused();
});

test('the demo partner goes online with a pretend location', async ({ page }, testInfo) => {
  test.skip(projectOf(testInfo) !== 'partner-1440', 'The demo partner is shared by everyone.');
  await signInTo(page, PARTNERS.riley);
  await open(page, '/partner');
  await expect(page.getByText(/^Demo partner: we use a pretend location/)).toBeVisible();
  // The demo partner's state is shared by every visitor: start from offline.
  const offline = page.getByRole('button', { name: 'Go offline' });
  if (await offline.isVisible()) {
    await offline.click();
    await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible();
  }
  await page.getByRole('button', { name: /^Go online/ }).click();
  await expect(page.getByText('Pretend location near the kitchen', { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText('Not your real location')).toBeVisible();
  await expectKitchenPinInMap(page);
  await expectNoAxeViolations(page);
  await page.getByRole('button', { name: 'Go offline' }).click();
  await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible();
});

test('Marco applies with a photo and his license, then withdraws', async ({ page }, testInfo) => {
  test.skip(projectOf(testInfo) !== 'partner-375', "One project sends Marco's application.");
  test.setTimeout(150_000);
  // A drawn picture from the site's own files: never a real face or ID.
  const picture = path.join(process.cwd(), 'public', 'noimage.png');
  await signInTo(page, PARTNERS.marco, '/partner/apply');
  await expect(page.getByRole('heading', { level: 1, name: 'About you' })).toBeVisible();

  // Step 1: the photo goes up with real progress, is checked, then shows (design 4.4).
  await page.getByLabel('Choose a photo').setInputFiles(picture);
  const photoField = page.getByRole('group', { name: 'Profile photo' });
  await expect(photoField.getByText('Photo added')).toBeVisible({ timeout: 45_000 });

  // A reload on step 1 draws the draft's photo again, not an empty field (design review S8).
  await page.waitForFunction(() =>
    Object.keys(window.localStorage).some((key) => key.startsWith('foodz.partner-apply:')),
  );
  await page.goto('/partner/apply?step=1');
  await expect(page.getByText('We kept what you entered on this phone.')).toBeVisible();
  await expect(photoField.getByText('Photo added')).toBeVisible({ timeout: 15_000 });
  await expect(photoField.getByLabel('Change photo')).toBeAttached();
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 2: a scooter needs a plate, shown back in capitals.
  await expect(page.getByRole('heading', { level: 1, name: 'Your vehicle' })).toBeVisible();
  await page.getByText('Scooter or moped', { exact: true }).click();
  await page.getByLabel('Plate number').fill('7kt 342');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 3: the license, its number and expiry, and a photo of its front.
  await expect(page.getByRole('heading', { level: 1, name: 'Your ID' })).toBeVisible();
  await expect(page.getByText("You need a driver's license to deliver by scooter.")).toBeVisible();
  await page.getByLabel('License number').fill('S4820 4821');
  await page.getByLabel('Expiry date').fill('2029-03-03');
  await page.getByLabel('Choose a photo').setInputFiles(picture);
  await expect(
    page
      .getByRole('group', { name: 'Photo of the front of your license' })
      .getByText('Photo added'),
  ).toBeVisible({ timeout: 45_000 });
  await expectNoAxeViolations(page);
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Check and send' })).toBeVisible();

  // A reload keeps everything on this phone but the ID number (design 4.2): the form opens on
  // the step that lacks it, fully drawn (design review B1), and the photos come back (S1).
  await page.reload();
  await expect(page.getByText('We kept what you entered on this phone.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Your ID' })).toBeVisible();
  await expect(page.locator('form > div').first()).toHaveCSS('opacity', '1');
  await expectNoAxeViolations(page);
  await page.getByLabel('License number').fill('S4820 4821');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('form > div').first()).toHaveCSS('opacity', '1');
  await expect(
    page
      .locator('section', { has: page.getByRole('heading', { name: 'About you' }) })
      .locator('img'),
  ).toHaveCount(1);
  await expectNoAxeViolations(page);

  // Step 4: the summary shows only the last four; both boxes are needed.
  await expect(page.getByRole('heading', { level: 1, name: 'Check and send' })).toBeVisible();
  await expect(page.getByText(/Driver's license ending 4821 · expires Mar 3, 2029/)).toBeVisible();
  await expect(page.getByText('S48204821')).toHaveCount(0);
  await page.getByRole('button', { name: 'Send application' }).click();
  await expect(page.getByRole('main').getByText('Please fix these before you send:')).toBeVisible();
  await page.getByLabel("I'm 18 or older.").check();
  await page.getByLabel('I agree to the Foodz Partner Terms').check();
  await page.getByRole('button', { name: 'Send application' }).click();

  await expect(
    page.getByRole('heading', { level: 1, name: "We're checking your application" }),
  ).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText('Scooter or moped · 7KT 342')).toBeVisible();

  // Withdrawing deletes it and opens an empty form with the confirmation (design 5.3).
  await page.getByRole('button', { name: 'Withdraw application' }).click();
  await page
    .getByRole('alertdialog', { name: 'Withdraw your application?' })
    .getByRole('button', { name: 'Withdraw', exact: true })
    .click();
  await expect(
    page
      .getByRole('main')
      .getByText("Application withdrawn. We've deleted your photos and ID details."),
  ).toBeVisible({
    timeout: 15_000,
  });
});

test('the installed app opens its offline page at /partner without a connection', async ({
  page,
  context,
}, testInfo) => {
  test.skip(projectOf(testInfo) !== 'partner-1440', 'The worker is the same at every width.');
  await signInTo(page, PARTNERS.jonas);
  await open(page, '/partner');
  // The worker controls /partner itself, the start page (scope /partner, security S9).
  await page.waitForFunction(async () => {
    await navigator.serviceWorker.ready;
    return navigator.serviceWorker.controller !== null;
  });
  await context.setOffline(true);
  await page.reload().catch(() => undefined);
  await expect(page.getByRole('heading', { level: 1, name: "You're offline" })).toBeVisible();
  await expect(
    page.getByText("Foodz Partner needs a connection to start. Your location isn't being shared."),
  ).toBeVisible();
  await context.setOffline(false);
});

test('an approximate location stops finding and explains Precise Location', async ({
  page,
  context,
}, testInfo) => {
  test.skip(projectOf(testInfo) !== 'partner-1440', "One project changes Grace's online state.");
  // Precise Location off: one fix, 2 km wide, and no second one (P9.6, D21).
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ ...ROUTE.R0, accuracy: 2_000 });
  await signInTo(page, PARTNERS.grace);
  await open(page, '/partner');
  await page.getByRole('button', { name: /^Go online/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Your phone is sharing an approximate location' }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: /^Go online/ })).toBeVisible();
  await expect(page.getByRole('banner').getByText('Offline', { exact: true })).toBeVisible();
  await expectNoAxeViolations(page);
});
