import {
  expect,
  latestEmail,
  linkIn,
  newPassword,
  open,
  signUp,
  test,
  uniqueEmail,
} from './support';

/*
 * The emails go through the job queue (Inngest) to Mailpit; the links are read from Mailpit's API
 * and opened like a person tapping them.
 */

test.describe('Email links (S3)', () => {
  test('the confirm link signs in a new browser, then the original tab shows "Confirmed" (S3.1, S3.2, S3.5)', async ({
    page,
    browser,
  }) => {
    const account = await signUp(page, { from: '/sign-up?callbackUrl=%2Fmenu' });
    const email = await latestEmail(account.email, 'Confirm your email for Foodz');
    expect(email).toContain('The link works for 24 hours');
    const link = linkIn(email, '/api/auth/verify-email');

    // Another browser (a mail app's own): confirmed and signed in there.
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await otherPage.goto(link);
    await expect(
      otherPage.getByRole('heading', { level: 1, name: 'Email confirmed' }),
    ).toBeFocused();
    await expect(otherPage.getByRole('link', { name: 'Continue to the menu' })).toBeVisible();
    await expect(otherPage.getByRole('button', { name: 'Account menu for Maya' })).toBeVisible();

    // The same link again: already confirmed, never an error.
    await otherPage.goto(link);
    await expect(
      otherPage.getByRole('heading', { level: 1, name: 'Your email is already confirmed' }),
    ).toBeVisible();
    await other.close();

    // The original tab learns it on its next page.
    await open(page, '/account');
    await expect(page.getByRole('region', { name: 'Email' }).getByText('Confirmed')).toBeVisible();
    await expect(page.getByRole('region', { name: /^Welcome, Maya\./ })).toHaveCount(0);
  });

  test('confirming in the signed-in browser returns with "Email confirmed" (S3.2)', async ({
    page,
  }) => {
    const account = await signUp(page, { from: '/sign-up?callbackUrl=%2Fmenu' });
    const link = linkIn(
      await latestEmail(account.email, 'Confirm your email for Foodz'),
      '/api/auth/verify-email',
    );
    await page.goto(link);
    await expect(page).toHaveURL(/\/menu$/);
    const notice = page.getByRole('region', { name: "Email confirmed. You're ready to order." });
    await expect(notice).toBeFocused();
  });

  test("someone else's confirm link confirms that address and keeps this browser signed in (security S2)", async ({
    page,
  }) => {
    // A stranger signs up and, instead of confirming, sends Maya the link.
    const stranger = await signUp(page, { name: 'Sam Stranger' });
    const link = linkIn(
      await latestEmail(stranger.email, 'Confirm your email for Foodz'),
      '/api/auth/verify-email',
    );
    await page.context().clearCookies();

    // Maya, signed in to her own account, opens it.
    const maya = await signUp(page, { name: 'Maya Lopez' });
    await page.goto(link);
    await expect(page).toHaveURL(/\/verify-email\?.*via=other-account/);
    await expect(page.getByRole('heading', { level: 1, name: 'Email confirmed' })).toBeFocused();
    const main = page.getByRole('main');
    await expect(
      main.getByText(
        'That email address is confirmed. It belongs to another Foodz account, so nothing changed here.',
      ),
    ).toBeVisible();
    await expect(main.getByText(`You're still signed in as ${maya.email}.`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Account menu for Maya' })).toBeVisible();

    // Still Maya's account, and hers is still waiting for its own confirmation.
    await open(page, '/account');
    const email = page.getByRole('region', { name: 'Email' });
    await expect(email.getByText(maya.email, { exact: true })).toBeVisible();
    await expect(email.getByText('Not confirmed')).toBeVisible();
  });

  test('an expired or tampered link reads as expired and offers a new one (S3.5)', async ({
    page,
  }) => {
    await open(page, '/verify-email?error=INVALID_TOKEN');
    await expect(
      page.getByRole('heading', { level: 1, name: 'This link has expired' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in to get a new link' })).toHaveAttribute(
      'href',
      '/sign-in?callbackUrl=%2Faccount%3Fresend%3D1',
    );
    await open(page, '/reset-password?error=INVALID_TOKEN');
    await expect(
      page.getByRole('heading', { level: 1, name: 'This link no longer works' }),
    ).toBeVisible();
    await expect(page.getByLabel('Email')).toBeFocused();
    await expect(page.getByText(/invalid/i)).toHaveCount(0);
  });

  test('a forgotten password: the reset link, a new password, then sign in (S3.8 to S3.11)', async ({
    page,
  }) => {
    const account = await signUp(page);
    await page.context().clearCookies();

    await open(page, '/sign-in');
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await page.getByLabel('Email').fill(account.email);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    // The panel replaces the title block, so its heading is the page's one h1 (S7.7).
    const sent = page.getByRole('heading', { level: 1, name: 'Check your email' });
    await expect(sent).toBeFocused({ timeout: 30_000 });
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.getByText(`If there's a Foodz account for ${account.email}`)).toBeVisible();

    // An unknown address gets exactly the same answer.
    await page.getByRole('button', { name: 'Use a different email' }).click();
    await page.getByLabel('Email').fill(uniqueEmail('nobody'));
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(sent).toBeFocused({ timeout: 30_000 });

    const link = linkIn(
      await latestEmail(account.email, 'Reset your Foodz password'),
      '/api/auth/reset-password/',
    );
    await page.goto(link);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Choose a new password' }),
    ).toBeVisible();
    const password = newPassword();
    await page.getByLabel('New password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Save new password' }).click();

    // Back on sign-in with the notice and the email filled in.
    await expect(page).toHaveURL(/\/sign-in\?notice=password-changed/, { timeout: 30_000 });
    await expect(
      page.getByRole('main').getByText('Password changed. Sign in with your new password.'),
    ).toBeVisible();
    await expect(page.getByLabel('Email')).toHaveValue(account.email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('button', { name: 'Account menu for Maya' })).toBeVisible({
      timeout: 30_000,
    });

    // The link worked once only.
    await page.goto(link);
    await expect(
      page.getByRole('heading', { level: 1, name: 'This link no longer works' }),
    ).toBeVisible();
  });
});
