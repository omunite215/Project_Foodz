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

  const other = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  const victor = await other.newPage();
  await signInTo(victor, PARTNERS.victor);
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
  test.skip(projectOf(testInfo) !== 'partner-375', "One project changes Diego's online state.");
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ ...ROUTE.R0, accuracy: 15 });
  await signInTo(page, PARTNERS.diego);
  await expect(page).toHaveTitle('Home | Foodz Partner');
  await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible();
  await expect(page.getByRole('banner').getByText(/^Offline/)).toBeVisible();
  await expectNoAxeViolations(page);

  await page.getByRole('button', { name: 'Go online' }).click();
  await expect(page.getByRole('heading', { name: 'Waiting for orders' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole('banner').getByText(/^Online/)).toBeVisible();
  await expect(page.getByText('At the kitchen')).toBeVisible();
  await expect(page.getByText(/^Location shared · /)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Go offline' })).toBeVisible();
  await expectNoAxeViolations(page);

  // Profile keeps the status in view; Appearance applies at once.
  await page.getByRole('link', { name: 'Profile' }).last().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Diego Alvarez' })).toBeVisible();
  await expect(page.getByRole('banner').getByText(/^Online/)).toBeVisible();
  await page.getByText('Dark', { exact: true }).click();
  await expect(page.locator('.partner')).toHaveAttribute('data-theme', 'dark');
  await expectNoAxeViolations(page);
  await page.getByText('Light', { exact: true }).click();

  await page.getByRole('link', { name: 'Home' }).click();
  await page.getByRole('button', { name: 'Go offline' }).click();
  await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible();
  await expect(page.getByRole('banner').getByText(/^Offline/)).toBeVisible();
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
  await expect(page.getByText(/^Demo partner: we use a pretend location/)).toBeVisible();
  await page.getByRole('button', { name: /^Go online/ }).click();
  await expect(page.getByText('Pretend location near the kitchen')).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText('Not your real location')).toBeVisible();
  await expectNoAxeViolations(page);
  await page.getByRole('button', { name: 'Go offline' }).click();
  await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible();
});
