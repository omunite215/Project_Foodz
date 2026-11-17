import { ACCOUNTS, DEMO_PASSWORD, expect, liveRegion, open, signIn, test } from './support';

const DEMO_NOTICE =
  "You're using the shared demo account. Other visitors use it too and it's reset every night, so please don't enter real personal details.";

test.describe('The shared demo account (S5.12, S5.13, U2)', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, ACCOUNTS.demo, DEMO_PASSWORD);
  });

  test('every blocked action is replaced by its reason, never a control that fails', async ({
    page,
  }) => {
    // The menu says it is the shared account.
    await page.getByRole('button', { name: /^Account menu for / }).click();
    await expect(page.getByRole('menu').getByText('Shared demo account')).toBeVisible();
    await page.keyboard.press('Escape');

    await open(page, '/account');
    await expect(page.getByRole('main').getByText(DEMO_NOTICE)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Email' }).getByText('Confirmed')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resend link' })).toHaveCount(0);
    const name = page.getByLabel('Name');
    await expect(name).toHaveAttribute('readonly', '');
    await expect(name).toHaveAccessibleDescription(/The demo account's profile can't be changed\./);
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);

    await open(page, '/account/security');
    await expect(page.getByText("The demo account's password can't be changed.")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change password' })).toHaveCount(0);
    const devices = page.getByRole('region', { name: 'Signed-in devices' });
    await expect(devices.getByRole('listitem')).toHaveCount(1);
    await expect(devices.getByText('This device')).toBeVisible();
    await expect(
      devices.getByText("Other visitors' devices aren't shown on the shared demo account."),
    ).toBeVisible();
    await expect(devices.getByRole('button')).toHaveCount(0);

    await open(page, '/account/privacy');
    await expect(
      page.getByText("The demo account can't be deleted. Create your own account to try this."),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Delete my account' })).toHaveCount(0);
    // Download is allowed (seeded data and this session only). Every run shares this account, so
    // the hourly download limit may already be used up; then the limit, not a block, answers.
    const download = page.waitForEvent('download', { timeout: 20_000 }).then(
      (file) => file.suggestedFilename(),
      () => null,
    );
    await page.getByRole('button', { name: 'Download my data' }).click();
    const limit = page.getByRole('main').getByText(/^You can download your data again at /);
    await expect(
      page
        .getByRole('main')
        .getByText(/^Downloaded foodz-data-.+\.json$/)
        .or(limit),
    ).toBeVisible({
      timeout: 20_000,
    });
    if (!(await limit.isVisible())) expect(await download).toMatch(/^foodz-data-.+\.json$/);
  });

  test('addresses are read-only, but the delivery check still works', async ({ page }) => {
    await open(page, '/account/addresses');
    const home = page.getByRole('article', { name: 'Home' });
    await expect(home.getByText('12 Peterborough Street')).toBeVisible();
    await expect(home.getByRole('button')).toHaveCount(0);
    await expect(home.getByRole('link')).toHaveCount(0);
    await expect(
      page.getByText(
        "The demo account's addresses can't be changed. You can still try the delivery check.",
      ),
    ).toBeVisible();

    await page.getByRole('link', { name: 'Try the delivery check' }).click();
    const field = page.getByRole('combobox', { name: 'Address' });
    await field.pressSequentially('Harvard Square Cambridge', { delay: 25 });
    await page.getByRole('option').first().waitFor({ timeout: 20_000 });
    await field.press('ArrowDown');
    await field.press('Enter');
    await expect(page.locator('#delivery-result')).toHaveText(/^We deliver here/, {
      timeout: 20_000,
    });
    await expect(liveRegion(page)).toHaveText(/We deliver here/);
    await expect(page.getByRole('button', { name: 'Save address' })).toHaveCount(0);
    await expect(
      page
        .getByText("The demo account can't save addresses. Create your own account to save yours.")
        .first(),
    ).toBeVisible();
  });

  test('the demo notice can be dismissed for this visit', async ({ page }) => {
    await open(page, '/account');
    const notice = page.getByRole('main').getByText(DEMO_NOTICE);
    await expect(notice).toBeVisible();
    await page.getByRole('main').getByRole('button', { name: 'Dismiss' }).click();
    await expect(notice).toHaveCount(0);
    // Remembered by the server for this browser session.
    await expect
      .poll(async () =>
        (await page.context().cookies()).some((cookie) => cookie.name === 'foodz_demo_notice'),
      )
      .toBe(true);
    await open(page, '/account/security');
    await expect(page.getByRole('main').getByText(DEMO_NOTICE)).toHaveCount(0);
  });
});
