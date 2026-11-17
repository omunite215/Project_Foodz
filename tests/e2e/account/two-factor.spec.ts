import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  adminTotpSecret,
  expect,
  freshTotp,
  open,
  test,
} from './support';

test.describe('The two-factor step (S2.9)', () => {
  test('without a sign-in waiting, the step has timed out and offers a fresh start', async ({
    page,
  }) => {
    await open(page, '/sign-in/two-factor?callbackUrl=%2Fmenu');
    await expect(page).toHaveTitle('Enter your code | Foodz');
    await expect(
      page.getByRole('main').getByText('This sign-in timed out. Please start again.'),
    ).toBeVisible();
    await expect(page.getByLabel('6-digit code')).toHaveCount(0);
    await page.getByRole('link', { name: 'Start again' }).click();
    await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2Fmenu$/);
  });

  test('the seeded admin enters a code: a wrong one is refused, the right one signs in', async ({
    page,
  }) => {
    const secret = adminTotpSecret();
    // CI always provides the seed output; locally it is optional.
    test.skip(!secret && !process.env.CI, 'Set E2E_SEED_OUTPUT to the seed output to run this.');
    if (!secret) throw new Error('E2E_SEED_OUTPUT must name the seed output in CI.');

    await open(page, '/sign-in?callbackUrl=%2Fmenu');
    await page.getByLabel('Email').fill(ADMIN_EMAIL);
    await page.getByLabel('Password', { exact: true }).fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL(/\/sign-in\/two-factor\?callbackUrl=%2Fmenu$/, {
      timeout: 30_000,
    });
    await expect(page.getByRole('heading', { level: 1, name: 'Enter your code' })).toBeVisible();
    const code = page.getByLabel('6-digit code');
    await expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    await expect(code).toHaveAttribute('inputmode', 'numeric');
    // Staff are never offered "Don't ask again" (admin section of the stories).
    await expect(page.getByLabel("Don't ask again on this device for 30 days")).toHaveCount(0);
    // Nothing about the account shows until the code is right.
    await expect(page.getByText(ADMIN_EMAIL)).toHaveCount(0);

    // The other method swaps the field and back.
    await page.getByRole('button', { name: 'Use a backup code instead' }).click();
    await expect(page.getByLabel('Backup code')).toBeFocused();
    await page.getByRole('button', { name: 'Use your authenticator app instead' }).click();

    const right = await freshTotp(secret);
    const wrong = String((Number(right) + 500_000) % 1_000_000).padStart(6, '0');
    await code.fill(`${wrong.slice(0, 3)} ${wrong.slice(3)}`);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(
      page.getByRole('main').getByText("That code didn't work. Check your app and try again."),
    ).toBeVisible();
    await expect(code).toBeFocused();
    await expect(code).toHaveAttribute('aria-invalid', 'true');

    // Pasted with a space: still fine.
    await code.fill(`${right.slice(0, 3)} ${right.slice(3)}`);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/\/menu$/, { timeout: 30_000 });
    await expect(page.getByRole('button', { name: /^Account menu for / })).toBeVisible();
  });
});
