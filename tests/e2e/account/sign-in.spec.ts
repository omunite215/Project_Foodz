import {
  ACCOUNTS,
  addDishToCart,
  DEMO_PASSWORD,
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  isPhone,
  liveRegion,
  newPassword,
  open,
  savedCartCount,
  signIn,
  test,
  uniqueEmail,
  watchConsole,
} from './support';

const WRONG = "That email and password don't match. Try again, or reset your password.";

test.describe('Create an account (S1)', () => {
  test('signs up from a page with a cart and comes back signed in, cart kept (S1.2, S2.13)', async ({
    page,
  }, testInfo) => {
    await addDishToCart(page);
    const problems = watchConsole(page);

    // "Sign in" from the dish page carries it as the return path; then "Create an account".
    if (isPhone(testInfo)) {
      await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await page.locator('#mobile-nav').getByRole('link', { name: 'Create an account' }).click();
    } else {
      await page.locator('header').getByRole('link', { name: 'Sign in' }).click();
      await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2Fmenu%2Fyangnyeom-chicken$/);
      await page.getByRole('link', { name: 'Create an account' }).click();
    }
    await expect(page).toHaveURL(/\/sign-up\?callbackUrl=%2Fmenu%2Fyangnyeom-chicken$/);
    await expect(page).toHaveTitle('Create an account | Foodz');

    // Exactly three fields, labelled, with the hints visible before typing (S1.1).
    const form = page.getByRole('form', { name: 'Create an account' });
    await expect(form.getByRole('textbox')).toHaveCount(3);
    await expect(form.locator('input[type="password"]')).toHaveCount(1);
    await expect(
      form.getByText('We put it on your orders. Couriers see only your first name.'),
    ).toBeVisible();
    await expect(form.getByText('At least 10 characters')).toBeVisible();
    await expect(form.getByLabel('Email')).toHaveAttribute('autocomplete', 'email');
    await expect(form.getByLabel('Password', { exact: true })).toHaveAttribute(
      'autocomplete',
      'new-password',
    );

    const email = uniqueEmail('maya');
    await form.getByLabel('Name').fill('Maya Lopez');
    await form.getByLabel('Email').fill(email);
    await form.getByLabel('Password', { exact: true }).fill(newPassword());
    await form.getByRole('button', { name: 'Create account' }).click();

    // Back on the dish, signed in, with the welcome notice focused and the cart unchanged.
    await expect(page).toHaveURL(/\/menu\/yangnyeom-chicken$/, { timeout: 30_000 });
    const account = page.getByRole('button', { name: 'Account menu for Maya' });
    await expect(account).toBeVisible();
    const welcome = page.getByRole('region', { name: /^Welcome, Maya\./ });
    await expect(welcome).toContainText(email);
    await expect(welcome).toBeFocused();
    expect(await savedCartCount(page)).toBe(1);

    // The menu names the person; Sign out is a button, not a link (S5.8).
    await account.click();
    const menu = page.getByRole('menu');
    await expect(menu.getByText(email)).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Account' })).toHaveAttribute(
      'href',
      '/account',
    );
    await expect(menu.getByRole('menuitem', { name: 'Sign out' })).not.toHaveAttribute('href');
    await page.keyboard.press('Escape');
    await expect(account).toBeFocused();

    // Signed in, the sign-up page sends the person straight on (S2.7). (An account page: the
    // storefront's offer countdowns can mismatch when hydration crosses a minute boundary.)
    await open(page, '/sign-up?callbackUrl=%2Faccount');
    await expect(page).toHaveURL(/\/account$/);
    expect(problems).toEqual([]);
  });

  test('a taken email reads the same and does not sign in (S1.5)', async ({ page }) => {
    await open(page, '/sign-up');
    await page.getByLabel('Name').fill('Priya');
    await page.getByLabel('Email').fill(ACCOUNTS.second);
    await page.getByLabel('Password', { exact: true }).fill(newPassword());
    await page.getByRole('button', { name: 'Create account' }).click();

    const heading = page.getByRole('heading', { name: 'Check your inbox' });
    await expect(heading).toBeFocused({ timeout: 30_000 });
    await expect(
      page.getByRole('main').getByText(`We sent a link to ${ACCOUNTS.second}`),
    ).toBeVisible();
    await expect(page.getByRole('main').getByText(/already/i)).toHaveCount(0);
    await expect(page.locator('header').getByRole('link', { name: 'Sign in' })).toBeVisible();

    await page.getByRole('button', { name: 'Wrong address? Change it' }).click();
    await expect(page.getByLabel('Email')).toBeFocused();
  });

  test('field errors are words under the field, and nothing typed is lost (S1.3, S1.4, S7.5)', async ({
    page,
  }) => {
    await open(page, '/sign-up');
    await page.getByLabel('Name').fill('José');
    await page.getByLabel('Email').fill('maya@example');
    await page.getByLabel('Password', { exact: true }).fill('short');
    await page.getByRole('button', { name: 'Create account' }).click();

    const email = page.getByLabel('Email');
    await expect(email).toBeFocused();
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    await expect(
      page.getByRole('main').getByText('Enter an email address like name@example.com.'),
    ).toBeVisible();
    await expect(page.getByRole('main').getByText('Use at least 10 characters.')).toBeVisible();
    await expect(page.getByLabel('Name')).toHaveValue('José');

    // Fixed as typed once the error shows; the hint gains its tick at 10 characters.
    await email.fill('maya@example.com');
    await expect(email).not.toHaveAttribute('aria-invalid');
    await page.getByLabel('Password', { exact: true }).fill('ten chars!');
    await expect(page.getByRole('main').getByText('Use at least 10 characters.')).toHaveCount(0);
  });

  test('the email typo hint offers the likely address', async ({ page }) => {
    await open(page, '/sign-up');
    await page.getByLabel('Email').fill('maya@gmial.com');
    await page.getByLabel('Password', { exact: true }).focus();
    await page.getByRole('button', { name: 'Use maya@gmail.com' }).click();
    await expect(page.getByLabel('Email')).toHaveValue('maya@gmail.com');
  });

  test('when the security check cannot load, the form says so and keeps the details (S1.6)', async ({
    page,
  }) => {
    await page.route('https://challenges.cloudflare.com/**', (route) => route.abort());
    await open(page, '/sign-up');
    await page.getByLabel('Name').fill('Maya Lopez');
    await page.getByLabel('Email').fill(uniqueEmail('blocked'));
    await page.getByLabel('Password', { exact: true }).fill(newPassword());
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(
      page
        .getByRole('main')
        .getByText(
          "We couldn't run our quick security check. Check your connection, then try again.",
        ),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.getByLabel('Name')).toHaveValue('Maya Lopez');
  });
});

test.describe('Sign in (S2)', () => {
  test('a wrong password and an unknown email look the same (S2.3)', async ({ page }) => {
    await open(page, '/sign-in');
    await expect(page).toHaveTitle('Sign in | Foodz');
    await expect(page.getByLabel('Email')).toHaveAttribute('autocomplete', 'username');
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute(
      'autocomplete',
      'current-password',
    );

    await page.getByLabel('Email').fill(ACCOUNTS.unconfirmed);
    await page.getByLabel('Password', { exact: true }).fill('not the password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('main').getByText(WRONG)).toBeVisible();
    const password = page.getByLabel('Password', { exact: true });
    await expect(password).toHaveValue('');
    await expect(password).toBeFocused();
    await expect(page.getByLabel('Email')).toHaveValue(ACCOUNTS.unconfirmed);
    await expect(liveRegion(page)).toHaveText(WRONG);
    await expect(page.getByRole('link', { name: 'reset your password' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );

    // Unknown address: the same words.
    await open(page, '/sign-in');
    await page.getByLabel('Email').fill(uniqueEmail('nobody'));
    await page.getByLabel('Password', { exact: true }).fill('not the password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('main').getByText(WRONG)).toBeVisible();
  });

  test('a suspended account hears so only with the right password (S2.10)', async ({ page }) => {
    await open(page, '/sign-in');
    await page.getByLabel('Email').fill(ACCOUNTS.suspended);
    await page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(
      page
        .getByRole('main')
        .getByText('This account is suspended. Contact support if you think this is a mistake.'),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Contact support' })).toHaveAttribute(
      'href',
      '/contact',
    );
  });

  test('repeated failures bring the security check, then the real wait (S2.8, S2.14)', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const email = uniqueEmail('limited');
    await open(page, '/sign-in');
    // The first try needs no check at all.
    await expect(page.locator('iframe[src*="challenges.cloudflare.com"]')).toHaveCount(0);

    const button = page.getByRole('button', { name: 'Sign in' });
    const password = page.getByLabel('Password', { exact: true });
    for (let attempt = 1; attempt <= 5; attempt++) {
      await page.getByLabel('Email').fill(email);
      await password.fill(`wrong password ${attempt}`);
      await button.click();
      // A failed attempt empties the password.
      await expect(password).toHaveValue('', { timeout: 20_000 });
      await expect(page.getByRole('main').getByText(WRONG)).toBeVisible();
    }
    await password.fill('wrong password 6');
    await button.click();

    await expect(
      page
        .getByRole('main')
        .getByText(/^Too many attempts\. Try again in \d+ minutes?, or reset your password\.$/),
    ).toBeVisible({ timeout: 20_000 });
    // The wait blocks the button (it keeps its name) without a ticking countdown.
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByRole('link', { name: 'reset your password' })).toBeVisible();
  });

  test('with the check blocked, a sign-in that needs it says so with a retry (S1.6)', async ({
    page,
  }) => {
    await page.route('https://challenges.cloudflare.com/**', (route) => route.abort());
    const email = uniqueEmail('checkless');
    await open(page, '/sign-in');
    for (const attempt of [1, 2]) {
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password', { exact: true }).fill(`wrong password ${attempt}`);
      await page.getByRole('button', { name: 'Sign in' }).click();
      if (attempt === 1) {
        await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
        await expect(page.getByRole('main').getByText(WRONG)).toBeVisible();
      }
    }
    await expect(
      page
        .getByRole('main')
        .getByText(
          "We couldn't run our quick security check. Check your connection, then try again.",
        ),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('the return path is a plain path on this site, or Home (S2.4, S2.5)', async ({ page }) => {
    await open(page, '/menu');
    await signIn(
      page,
      ACCOUNTS.second,
      DEMO_PASSWORD,
      '/sign-in?callbackUrl=%2Fmenu%3Fcuisine%3Dthai',
    );
    await expect(page).toHaveURL(/\/menu\?cuisine=thai$/);
    // Back skips the form.
    await page.goBack();
    await expect(page).toHaveURL(/\/menu$/);

    for (const unsafe of ['https://evil.example', '//evil.example', '/sign-up']) {
      await open(page, `/sign-in?callbackUrl=${encodeURIComponent(unsafe)}`);
      // Already signed in: sent on, to Home.
      await expect(page).toHaveURL(/localhost:\d+\/$/);
    }
  });

  test('a signed-out visit to an account page signs in and comes back (S2.6)', async ({ page }) => {
    const response = await page.goto('/account/addresses');
    expect(response?.url()).toMatch(/\/sign-in\?callbackUrl=%2Faccount%2Faddresses$/);
    await page.getByLabel('Email').fill(ACCOUNTS.second);
    await page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/account\/addresses$/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Addresses' })).toBeVisible();
  });

  test('switching between the forms keeps the email (S2.2, S3.8)', async ({ page }) => {
    await open(page, '/sign-in');
    await page.getByLabel('Email').fill('maya@example.com');
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await expect(page).toHaveTitle('Reset your password | Foodz');
    await expect(page.getByLabel('Email')).toHaveValue('maya@example.com');
    await page.getByRole('link', { name: 'Back to sign in' }).click();
    await expect(page.getByLabel('Email')).toHaveValue('maya@example.com');
  });

  test('the sign-in pages pass accessibility checks and fit the screen (S7.1, S7.2)', async ({
    page,
  }, testInfo) => {
    for (const path of ['/sign-in', '/sign-up', '/forgot-password', '/sign-in/two-factor']) {
      await open(page, path);
      await expect(page.locator('h1')).toHaveCount(1);
      await expectAccessible(page);
      await expectNoSidewaysScroll(page);
    }
    // The panel shows from 1024 px only; on phones the form comes first.
    await open(page, '/sign-in');
    const panel = page.getByRole('complementary', { name: 'Good food, delivered warm.' });
    if (isPhone(testInfo)) await expect(panel).toBeHidden();
    else await expect(panel).toBeVisible();

    const toggle = page.getByRole('button', { name: 'Show password' });
    const box = await toggle.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    await page.getByLabel('Password', { exact: true }).fill('secret words');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
  });
});
