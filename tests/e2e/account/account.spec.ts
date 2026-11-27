import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Locator } from '@playwright/test';
import {
  addDishToCart,
  carriedEmail,
  carryEmail,
  endSessionElsewhere,
  expect,
  expectHeard,
  expectNoSidewaysScroll,
  isPhone,
  listenToLiveRegion,
  liveRegion,
  newPassword,
  open,
  savedCartCount,
  savedDrafts,
  SESSION_ENDED,
  signIn,
  signOutFromHeader,
  signUp,
  test,
} from './support';

const SIGNED_OUT_ELSEWHERE = 'You were signed out on this device, so we emptied your cart.';
const SIGN_OUT_REFUSED = "We couldn't sign you out. Please try again.";
const SIGN_OUT_OFFLINE = "You're offline. Try signing out again when you're back online.";
const DRAFT_RESTORED = 'We kept your changes. Press Save to keep them.';

/** The grey of a control that can't be used right now (design 2.5, `neutral-6`). */
const BLOCKED_FILL = 'rgb(230, 232, 236)';
const fill = (locator: Locator) =>
  locator.evaluate((element) => getComputedStyle(element).backgroundColor);

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
    // Home arrives late, as on a slow connection.
    await page.route(/\/\?_rsc=/, async (route) => {
      if (!route.request().headers()['next-router-prefetch']) {
        await new Promise((resolve) => setTimeout(resolve, 2_500));
      }
      await route.fallback();
    });
    if (isPhone(testInfo)) {
      await page.getByRole('button', { name: /^Account menu for / }).click();
      const item = page.getByRole('menuitem', { name: 'Sign out' });
      await expect(item).toBeVisible();
      // The sign-out answer comes back before the menu has finished closing (as on a fast
      // connection): the menu's return of focus to its button must not win over Home's content.
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Animation.enable');
      await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.1 });
      await item.click();
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

  test('a refused sign-out says so and keeps the account; only a lost connection reads as offline', async ({
    page,
  }) => {
    await signUp(page);
    const account = page.getByRole('button', { name: /^Account menu for / });
    // The floating message (the live region holds the same words, unseen).
    const toast = (text: string) =>
      page.locator('[data-slot="alert-description"]').filter({ hasText: text });
    const signOut = async () => {
      await account.click();
      await page.getByRole('menuitem', { name: 'Sign out' }).click();
    };

    // Online, and the server says no (403, 429 or 5xx).
    await page.route('**/api/auth/sign-out', (route) => route.fulfill({ status: 403, body: '{}' }));
    await signOut();
    await expect(toast(SIGN_OUT_REFUSED)).toBeVisible();
    await expect(liveRegion(page)).toHaveText(SIGN_OUT_REFUSED);
    await expect(toast(SIGN_OUT_OFFLINE)).toHaveCount(0);
    await expect(account).toBeVisible();

    // A request that never reaches the server is a connection problem.
    await page.unroute('**/api/auth/sign-out');
    await page.route('**/api/auth/sign-out', (route) => route.abort('internetdisconnected'));
    await signOut();
    await expect(toast(SIGN_OUT_OFFLINE)).toBeVisible();
    await expect(account).toBeVisible();
  });

  test('signing out forgets the email the sign-in forms carry, so the next person starts empty (S2.2)', async ({
    page,
  }) => {
    await signUp(page);
    // Signing up is signing in: the email has done its job.
    expect(await carriedEmail(page)).toBeNull();

    // Whatever this tab still carries goes with the sign-out.
    await carryEmail(page, 'last.customer@example.com');
    await signOutFromHeader(page);
    expect(await carriedEmail(page)).toBeNull();
    await page.locator('header').getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveTitle('Sign in | Foodz');
    await expect(page.getByLabel('Email')).toHaveValue('');
  });
});

test.describe('A session that ends while a form is open (S2.12, S5.8)', () => {
  test('ended on another device: Save says so, and after signing in the typed profile is back (S7.6)', async ({
    page,
    browser,
  }) => {
    const account = await signUp(page);
    await open(page, '/account');
    const profile = page.getByRole('form', { name: 'Profile' });
    await profile.getByLabel('Name').fill('Maya Draft Name');
    const phone = profile.getByLabel('Phone (optional)');
    await phone.fill('617-555-0142');
    await phone.blur();
    // Something the sign-in forms carry, which must not outlive the session (S2.2).
    await carryEmail(page, 'last.customer@example.com');

    await endSessionElsewhere(browser, account);

    await profile.getByRole('button', { name: 'Save changes' }).click();
    await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2Faccount&notice=session-ended$/, {
      timeout: 30_000,
    });
    await expect(page.getByRole('main').getByText(SESSION_ENDED)).toBeVisible();
    // The reason has focus and is read out (S7.6).
    await expect(page.locator(':focus')).toContainText(SESSION_ENDED);
    await expect(liveRegion(page)).toHaveText(SESSION_ENDED);
    await expect(page.locator('header').getByRole('link', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByLabel('Email')).toHaveValue('');
    expect(await savedDrafts(page)).toEqual(['foodz.draft:/account']);

    await page.getByLabel('Email').fill(account.email);
    await page.getByLabel('Password', { exact: true }).fill(account.password);
    await listenToLiveRegion(page);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Back on the form, with what was typed.
    await expect(page).toHaveURL(/\/account$/, { timeout: 30_000 });
    await expect(profile.getByLabel('Name')).toHaveValue('Maya Draft Name');
    await expect(phone).toHaveValue('(617) 555-0142');
    await expectHeard(page, DRAFT_RESTORED);
    // Given back once, then gone.
    expect(await savedDrafts(page)).toEqual([]);
    await profile.getByRole('button', { name: 'Save changes' }).click();
    await expect(profile.getByText('Saved')).toBeVisible();
    await expect(profile.getByLabel('Name')).toHaveValue('Maya Draft Name');
  });

  test('signed out in another tab: this tab keeps its typing, and the draft never reaches someone else', async ({
    page,
    context,
  }) => {
    await signUp(page);
    await open(page, '/account');
    const profile = page.getByRole('form', { name: 'Profile' });
    await profile.getByLabel('Name').fill('Maya Draft Name');

    const other = await context.newPage();
    await open(other, '/menu');
    await signOutFromHeader(other);

    // This tab hears of it, but shows it only on its next action (S5.8): nothing typed is lost.
    await page.bringToFront();
    await page.waitForTimeout(1_500);
    await expect(page).toHaveURL(/\/account$/);
    await expect(profile.getByLabel('Name')).toHaveValue('Maya Draft Name');

    await profile.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('main').getByText(SESSION_ENDED)).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/sign-in?callbackUrl=%2Faccount&notice=session-ended',
    );
    expect(await savedDrafts(page)).toEqual(['foodz.draft:/account']);

    // Someone else signs in on this device: the draft is not theirs, so it is dropped unseen.
    await signUp(page, { name: 'Priya Shah' });
    await open(page, '/account');
    await expect(profile.getByLabel('Name')).toHaveValue('Priya Shah');
    await expect(liveRegion(page)).not.toHaveText(DRAFT_RESTORED);
    expect(await savedDrafts(page)).toEqual([]);
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
    // Nothing to save yet, and it looks it (design 2.5).
    expect(await fill(save)).toBe(BLOCKED_FILL);
    await save.click({ force: true });
    await expect(liveRegion(page)).toHaveText('No changes to save.');

    await profile.getByLabel('Name').fill('  Maya   Lopez-Ruiz ');
    const phone = profile.getByLabel('Phone (optional)');
    await expect(phone).toHaveAttribute('type', 'tel');
    await expect(phone).toHaveAttribute('autocomplete', 'tel');
    await phone.fill('617-555-0142');
    await phone.blur();
    await expect(phone).toHaveValue('(617) 555-0142');
    expect(await fill(save)).not.toBe(BLOCKED_FILL);
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
    const width = (await resend.boundingBox())?.width;
    await resend.click();
    // The countdown sits in the status line, which is not a live region; the button keeps its
    // name and width, and looks blocked while it rests.
    const status = page
      .getByRole('main')
      .getByText(/^Sent\. Check your inbox and spam folder\. You can resend in \d+ s\.$/);
    await expect(status).toBeVisible();
    await expect(liveRegion(page)).toHaveText('Sent. Check your inbox and spam folder.');
    await expect(status).not.toHaveAttribute('aria-live');
    await expect(status).not.toHaveAttribute('role');
    await expect(resend).toHaveAttribute('aria-disabled', 'true');
    expect((await resend.boundingBox())?.width).toBe(width);
    // The fill eases into the grey, so it is read once the change has settled.
    await expect.poll(() => fill(resend)).toBe(BLOCKED_FILL);
    // Resting, the button names its reason: the line with the countdown (design 4.2).
    const describedBy = await resend.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    await expect(page.locator(`[id="${describedBy}"]`)).toHaveText(
      // A no-break space keeps the number and its unit together.
      /^Sent\. Check your inbox and spam folder\. You can resend in \d+\ss\.$/,
    );
  });

  test('a server error under a field goes once that field changes (S7.5)', async ({ page }) => {
    await signUp(page);
    await open(page, '/account/security');
    await page.getByRole('button', { name: 'Change password' }).click();
    const form = page.getByRole('form', { name: 'Change password' });
    const current = form.getByLabel('Current password', { exact: true });
    await current.fill('not my password');
    await form.getByLabel('New password', { exact: true }).fill(newPassword());
    await form.getByRole('button', { name: 'Save new password' }).click();

    const wrong = form.getByText("Your current password isn't right.");
    await expect(wrong).toBeVisible();
    await expect(current).toBeFocused();
    await expect(current).toHaveAttribute('aria-invalid', 'true');

    // A new value is not the one the server refused.
    await current.press('End');
    await current.pressSequentially('!');
    await expect(wrong).toHaveCount(0);
    await expect(current).not.toHaveAttribute('aria-invalid');
  });

  test('Cancel on Change password empties the form and returns focus to its button (design 4.3)', async ({
    page,
  }) => {
    await signUp(page);
    await open(page, '/account/security');
    const toggle = page.getByRole('button', { name: 'Change password' });
    await toggle.click();
    const form = page.getByRole('form', { name: 'Change password' });
    const current = form.getByLabel('Current password', { exact: true });
    await expect(current).toBeFocused();
    await current.fill('half typed');
    await form.getByRole('button', { name: 'Cancel' }).focus();
    await page.keyboard.press('Enter');
    await expect(form).toHaveCount(0);
    await expect(toggle).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(current).toHaveValue('');
  });

  test('a long email wraps instead of widening the page (S7.12)', async ({ page }) => {
    // 58 characters, as some work addresses are.
    const email = `maximiliana.lopez-ruiz-${randomUUID().slice(0, 12)}@deliveries.example.com`;
    await signUp(page, { email });
    await open(page, '/account');
    await expect(page.getByRole('main').getByText(`We sent the link to ${email}.`)).toBeVisible();
    await expectNoSidewaysScroll(page);
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
    expect(Object.keys(data)).toEqual([
      'about',
      'profile',
      'addresses',
      'devices',
      'favorites',
      'orders',
      'savedCards',
      // F9 (S9.6): her own ratings, empty for a new account.
      'ratings',
    ]);
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
