import { readFileSync } from 'node:fs';
import {
  addDishToCart,
  expect,
  isPhone,
  liveRegion,
  newPassword,
  open,
  savedCartCount,
  signIn,
  signUp,
  test,
} from './support';

const SIGNED_OUT_ELSEWHERE = 'You were signed out on this device, so we emptied your cart.';

test.describe('Signing out (S5.8, S5.10)', () => {
  test('with a cart, sign-out asks first, then empties the cart on this device', async ({
    page,
  }) => {
    await addDishToCart(page);
    await signUp(page, { from: '/sign-up?callbackUrl=%2Fmenu' });
    await expect(page).toHaveURL(/\/menu$/);

    const trigger = page.getByRole('button', { name: 'Account menu for Maya' });
    await trigger.click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();

    const dialog = page.getByRole('alertdialog', { name: 'Sign out?' });
    await expect(dialog).toContainText('Signing out empties your cart on this device (1 item).');
    // Cancel has the first focus; cancelling keeps everything and returns focus to the menu.
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(await savedCartCount(page)).toBe(1);

    await trigger.click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await dialog.getByRole('button', { name: 'Sign out' }).click();

    // Still on the menu (a public page), signed out, cart empty, focus on "Sign in".
    await expect(page).toHaveURL(/\/menu$/);
    const signInLink = page.locator('header').getByRole('link', { name: 'Sign in' });
    await expect(signInLink).toBeFocused({ timeout: 15_000 });
    await expect(liveRegion(page)).toHaveText("You're signed out");
    expect(await savedCartCount(page)).toBe(0);
  });

  test('from an account page, sign-out lands on Home, and Back does not show the account (S5.9)', async ({
    page,
  }, testInfo) => {
    await signUp(page);
    await open(page, '/account');
    await page
      .getByRole('navigation', { name: 'Account' })
      .getByRole('link', { name: 'Security' })
      .click();
    await expect(page).toHaveURL(/\/account\/security$/);
    if (isPhone(testInfo)) {
      await page.getByRole('button', { name: /^Account menu for / }).click();
      await page.getByRole('menuitem', { name: 'Sign out' }).click();
    } else {
      await page
        .getByRole('navigation', { name: 'Account' })
        .getByRole('button', { name: 'Sign out' })
        .click();
    }
    await expect(page).toHaveURL(/localhost:\d+\/$/, { timeout: 15_000 });
    await expect(page.locator('#main')).toBeFocused();

    // Sign-out replaced the security page in history; Back reaches /account, which is never
    // shown from the cache: the server sends a signed-out visitor to sign in.
    await page.goBack();
    await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2Faccount$/, { timeout: 15_000 });
  });

  test('a session ended on another device empties the cart here, and says so (S5.7, S5.10)', async ({
    page,
    browser,
  }) => {
    const account = await signUp(page);
    await addDishToCart(page);

    // The same account on a second device signs this one out.
    const other = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
    });
    const second = await other.newPage();
    await signIn(second, account.email, account.password);
    await open(second, '/account/security');
    const devices = second.getByRole('region', { name: 'Signed-in devices' });
    await expect(devices.getByText('This device')).toBeVisible();
    const signOutOther = devices.getByRole('listitem').getByRole('button', { name: /^Sign out / });
    await expect(signOutOther).toHaveCount(1);
    await signOutOther.click();
    await expect(liveRegion(second)).toHaveText(/^Signed out /);
    await expect(devices.getByText('No other devices are signed in.')).toBeVisible();
    await other.close();

    // Back on the first device: signed out, cart emptied, told once.
    await open(page, '/menu');
    await expect(page.getByText(SIGNED_OUT_ELSEWHERE).first()).toBeVisible();
    await expect(page.locator('header').getByRole('link', { name: 'Sign in' })).toBeVisible();
    expect(await savedCartCount(page)).toBe(0);
    await page.getByRole('button', { name: 'Dismiss' }).last().click();
    await expect(page.getByRole('main').getByText(SIGNED_OUT_ELSEWHERE)).toHaveCount(0);
  });
});

test.describe('Your account (S3.3, S5.1 to S5.3)', () => {
  test('profile saves name and phone, and an unchanged form cannot be sent', async ({ page }) => {
    await signUp(page);
    await open(page, '/account');
    await expect(page).toHaveTitle('Your account | Foodz');

    // The email reads with its state, not by colour alone.
    const email = page.getByRole('region', { name: 'Email' });
    await expect(email.getByText('Not confirmed')).toBeVisible();

    const profile = page.getByRole('form', { name: 'Profile' });
    const save = profile.getByRole('button', { name: 'Save changes' });
    await expect(save).toHaveAttribute('aria-disabled', 'true');
    await save.click({ force: true });
    await expect(liveRegion(page)).toHaveText('No changes to save.');

    await profile.getByLabel('Name').fill('  Maya   Lopez-Ruiz ');
    const phone = profile.getByLabel('Phone (optional)');
    await expect(phone).toHaveAttribute('type', 'tel');
    await expect(phone).toHaveAttribute('autocomplete', 'tel');
    await phone.fill('617-555-0142');
    await phone.blur();
    await expect(phone).toHaveValue('(617) 555-0142');
    await save.click();
    await expect(profile.getByText('Saved')).toBeVisible();
    await expect(liveRegion(page)).toHaveText('Profile saved');
    await expect(profile.getByLabel('Name')).toHaveValue('Maya Lopez-Ruiz');
    await expect(save).toHaveAttribute('aria-disabled', 'true');

    // A number nobody can call is refused in words.
    await phone.fill('123');
    await phone.blur();
    await save.click();
    await expect(
      profile.getByText('Enter a number we can call, like (617) 555-0142.'),
    ).toBeVisible();
    await expect(phone).toHaveAttribute('aria-invalid', 'true');
    await expect(phone).toBeFocused();
  });

  test('resend rests for a minute with a visible, silent countdown (S3.4)', async ({ page }) => {
    await signUp(page);
    await open(page, '/account');
    const resend = page.getByRole('button', { name: 'Resend link' });
    await resend.click();
    await expect(
      page.getByRole('main').getByText('Sent. Check your inbox and spam folder.'),
    ).toBeVisible();
    const resting = page.getByRole('button', { name: /^You can resend in \d+ s$/ });
    await expect(resting).toHaveAttribute('aria-disabled', 'true');
    await expect(resting).not.toHaveAttribute('aria-live');
  });

  test('the welcome notice\'s "Change it" opens the change-email form (S3.6)', async ({ page }) => {
    await signUp(page);
    await page
      .getByRole('region', { name: /^Welcome, Maya\./ })
      .getByRole('link', { name: 'Change it' })
      .click();
    await expect(page).toHaveURL(/\/account#change-email$/);
    const newEmail = page.getByLabel('New email');
    await expect(newEmail).toBeFocused();
    await newEmail.fill(`maya-new-${Date.now()}@example.com`);
    await page.getByRole('button', { name: 'Send link', exact: true }).click();
    await expect(page.getByRole('main').getByText(/^We sent a link to maya-new-/)).toBeVisible();
  });
});

test.describe('Privacy and data (S6)', () => {
  test('downloads the data as a dated JSON file (S6.1, S6.2)', async ({ page }) => {
    const account = await signUp(page);
    await open(page, '/account/privacy');
    await expect(page).toHaveTitle('Privacy and data | Foodz');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download my data' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^foodz-data-\d{4}-\d{2}-\d{2}\.json$/);
    const data = JSON.parse(readFileSync(await file.path(), 'utf8'));
    expect(data.profile.email).toBe(account.email);
    expect(Object.keys(data)).toEqual(['about', 'profile', 'addresses', 'devices']);
    expect(Object.keys(data.profile)).not.toContain('password');
    expect(data.devices).toHaveLength(1);
    await expect(
      page.getByRole('main').getByText(`Downloaded ${file.suggestedFilename()}`),
    ).toBeVisible();
  });

  test('deleting the account signs out, lands on Home and frees the email (S6.4, S6.5)', async ({
    page,
  }) => {
    const account = await signUp(page);
    await addDishToCart(page);
    await open(page, '/account/privacy');
    await page.getByRole('link', { name: 'Delete my account' }).click();
    await expect(page).toHaveTitle('Delete your account | Foodz');
    for (const heading of ['What we delete', 'What we keep', 'On this device']) {
      await expect(page.getByRole('heading', { level: 2, name: heading })).toBeVisible();
    }
    await expect(page.getByText("It can't be undone.")).toBeVisible();

    // A fresh sign-in needs no password; a double press deletes once (S6.6).
    await page.getByRole('main').getByRole('button', { name: 'Delete my account' }).dblclick();
    await expect(page).toHaveURL(/localhost:\d+\/$/, { timeout: 30_000 });
    const notice = page.getByRole('region', { name: 'Your account has been deleted.' });
    await expect(notice).toBeFocused();
    await expect(page.locator('header').getByRole('link', { name: 'Sign in' })).toBeVisible();
    expect(await savedCartCount(page)).toBe(0);

    // The old details no longer sign in; the email can sign up again.
    await open(page, '/sign-in');
    await page.getByLabel('Email').fill(account.email);
    await page.getByLabel('Password', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(
      page
        .getByRole('main')
        .getByText("That email and password don't match. Try again, or reset your password."),
    ).toBeVisible();
    await signUp(page, { email: account.email, password: newPassword() });
  });
});
