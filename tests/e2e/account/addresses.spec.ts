import type { Locator, Page } from '@playwright/test';
import {
  expect,
  expectAccessible,
  expectNoSidewaysScroll,
  liveRegion,
  open,
  savedDrafts,
  SESSION_ENDED,
  signOutFromHeader,
  signUp,
  test,
  watchConsole,
} from './support';

/*
 * The address search goes to the real Photon service through the app's Server Action, so the
 * queries are well-known places around the kitchen (88 Harbor Street, Boston; 8 km radius).
 */

// A number and its unit never part at a line break (a no-break space joins them).
const INSIDE =
  /^We deliver here · (about [\d,]+\.\d|just under \d+|less than 0\.1) km from our kitchen$/;
const OUTSIDE =
  /^Sorry, we don't deliver to .+ yet\. It's (about [\d,]+\.\d|just over \d+) km from our kitchen at 88 Harbor Street, and we deliver within 8 km\.$/;

/** The grey of a control that can't be used right now (design 2.5, `neutral-6`). */
const BLOCKED_FILL = 'rgb(230, 232, 236)';
const fill = (locator: Locator) =>
  locator.evaluate((element) => getComputedStyle(element).backgroundColor);

/**
 * Types like a person, then picks by keyboard the first suggestion in `town` (the live search
 * may rank another town first), and fills a house number if the pick has none.
 */
async function pickAddress(page: Page, query: string, town: RegExp) {
  const field = page.getByRole('combobox', { name: 'Address' });
  await field.fill('');
  await field.pressSequentially(query, { delay: 25 });
  const options = page.getByRole('listbox', { name: 'Address suggestions' }).getByRole('option');
  await expect(options.filter({ hasText: town }).first()).toBeVisible({ timeout: 20_000 });
  await expect(field).toHaveAttribute('aria-expanded', 'true');
  const index = (await options.allInnerTexts()).findIndex((text) => town.test(text));
  for (let step = 0; step <= index; step++) await field.press('ArrowDown');
  await expect(options.nth(index)).toHaveAttribute('aria-selected', 'true');
  await field.press('Enter');
  await expect(page.getByRole('listbox')).toBeHidden();
  const houseNumber = page.getByLabel('House number');
  if (await houseNumber.isVisible()) await houseNumber.fill('1');
}

const result = (page: Page) => page.locator('#delivery-result');

test.describe('Address book (S4)', () => {
  test('add, check, move the pin, save, set default, edit and delete (S4.1 to S4.11)', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const problems = watchConsole(page);
    await signUp(page);
    await open(page, '/account/addresses');
    await expect(page).toHaveTitle('Addresses | Foodz');

    // Empty: one picture, one line, one action (S4.1).
    await expect(page.getByRole('heading', { name: 'No saved addresses yet' })).toBeVisible();
    await expect(
      page.getByRole('main').getByText('We deliver within 8 km of 88 Harbor Street, Boston.'),
    ).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Add an address' })).toHaveCount(1);
    await expectAccessible(page);
    await page.getByRole('link', { name: 'Add an address' }).click();

    await expect(page).toHaveTitle('Add an address | Foodz');
    const isDefault = page.getByLabel('Use as my default address');
    await expect(isDefault).toBeChecked();
    await expect(isDefault).toBeDisabled();
    await expect(page.getByText('Your first address is your default.')).toBeVisible();
    await expect(page.getByLabel('Apt, suite or floor (optional)')).toHaveAttribute(
      'autocomplete',
      'address-line2',
    );

    // Nothing picked: the reason under the field, and focus on it.
    await page.getByRole('button', { name: 'Save address' }).click();
    await expect(page.getByText('Pick an address from the suggestions.')).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Address' })).toBeFocused();

    // Five suggestions and their attribution fit the popup without scrolling it (5.5).
    await page
      .getByRole('combobox', { name: 'Address' })
      .pressSequentially('Faneuil Hall Boston', { delay: 25 });
    const attribution = page.getByText('Addresses © OpenStreetMap contributors');
    await expect(attribution).toBeVisible({ timeout: 20_000 });
    expect(
      await attribution.evaluate((element) => {
        const popup = element.parentElement!;
        return popup.scrollHeight - popup.clientHeight;
      }),
    ).toBeLessThanOrEqual(0);

    await pickAddress(page, '1 Faneuil Hall Square Boston', /Boston/);
    await expect(result(page)).toHaveText(INSIDE, { timeout: 20_000 });
    await expect(liveRegion(page)).toHaveText(INSIDE);

    // The pin moves without dragging: the map takes the arrow keys (S4.5).
    const map = page.getByRole('application', { name: /^Map of / });
    await expect(map).toBeVisible({ timeout: 20_000 });
    await map.focus();
    await page.keyboard.press('ArrowUp');
    await expect(liveRegion(page)).toHaveText(
      /^Pin moved 10 m up from the address\. We deliver here/,
      {
        timeout: 10_000,
      },
    );
    await page.getByRole('button', { name: 'Move pin right' }).click();
    await expect(page.getByRole('button', { name: 'Reset pin' })).not.toHaveAttribute(
      'aria-disabled',
    );

    await page.getByLabel('Apt, suite or floor (optional)').fill('Apt 3');
    await page.getByLabel('Instructions for the courier (optional)').fill('<b>Buzzer 3</b>');
    await page.getByRole('button', { name: 'Save address' }).click();

    // Back on the list: saved, announced, and that card has focus (S4.8).
    await expect(page).toHaveURL(/\/account\/addresses$/, { timeout: 20_000 });
    await expect(page.getByRole('main').getByText('Address saved')).toBeVisible();
    await expect(liveRegion(page)).toHaveText('Address saved');
    const home = page.getByRole('article', { name: 'Home' });
    await expect(home).toBeFocused();
    await expect(home.getByText('Default', { exact: true })).toBeVisible();
    await expect(home.getByText('<b>Buzzer 3</b>')).toBeVisible();

    // A second address, first outside the area: Save stays blocked with the reason (S4.7).
    await page.getByRole('link', { name: 'Add an address' }).click();
    await pickAddress(page, 'Quincy Center Quincy', /Quincy/);
    await expect(result(page).locator('p')).toHaveText(OUTSIDE, { timeout: 20_000 });
    await page.getByLabel('Apt, suite or floor (optional)').fill('Floor 2');
    const save = page.getByRole('button', { name: 'Save address' });
    await expect(save).toHaveAttribute('aria-disabled', 'true');
    await expect(save).toHaveAttribute('aria-describedby', 'delivery-result');
    // Blocked, so it doesn't look like it can be pressed (design 2.5).
    expect(await fill(save)).toBe(BLOCKED_FILL);
    await page.getByRole('button', { name: 'Try another address' }).click();
    await expect(page.getByRole('combobox', { name: 'Address' })).toBeFocused();
    await expect(page.getByLabel('Apt, suite or floor (optional)')).toHaveValue('Floor 2');

    await pickAddress(page, 'Harvard Square Cambridge', /Cambridge/);
    await expect(result(page)).toHaveText(INSIDE, { timeout: 20_000 });
    expect(await fill(save)).not.toBe(BLOCKED_FILL);
    await page.getByRole('radio', { name: 'Work' }).check({ force: true });
    await save.click();
    await expect(page).toHaveURL(/\/account\/addresses$/, { timeout: 20_000 });
    const work = page.getByRole('article', { name: 'Work' });
    await expect(work).toBeFocused();

    // Set as default moves the badge, and says so (S4.9).
    await work.getByRole('button', { name: /^Set as default/ }).click();
    await expect(
      page.getByRole('main').getByText('Work is now your default address'),
    ).toBeVisible();
    await expect(work.getByText('Default', { exact: true })).toBeVisible();
    await expect(home.getByText('Default', { exact: true })).toHaveCount(0);

    // Edit opens filled in (S4.10).
    await home.getByRole('link', { name: 'Edit Home' }).click();
    await expect(page).toHaveTitle('Edit address | Foodz');
    await expect(page.getByRole('heading', { level: 1, name: 'Edit Home' })).toBeVisible();
    await expect(page.getByLabel('Apt, suite or floor (optional)')).toHaveValue('Apt 3');
    await expect(result(page)).toHaveText(INSIDE);
    await page.getByLabel('Apt, suite or floor (optional)').fill('Apt 4');
    await page.getByRole('button', { name: 'Save address' }).click();
    await expect(page).toHaveURL(/\/account\/addresses$/, { timeout: 20_000 });
    await expect(home.getByText(/Apt 4/)).toBeVisible();

    // Cancelling, by Escape or by Cancel, returns focus to the Delete button (S7.8).
    const deleteWork = work.getByRole('button', { name: 'Delete Work' });
    const dialog = page.getByRole('alertdialog', { name: /^Delete Work, .+\?$/ });
    const cancel = dialog.getByRole('button', { name: 'Cancel' });
    await deleteWork.click();
    await expect(cancel).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(deleteWork).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(cancel).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(deleteWork).toBeFocused();

    // Deleting the default names it, then names the new default (S4.9, S4.11).
    await deleteWork.click();
    await expect(cancel).toBeFocused();
    await dialog.getByRole('button', { name: 'Delete address' }).click();
    await expect(liveRegion(page)).toHaveText('Address deleted. Home is now your default address');
    await expect(work).toHaveCount(0);
    await expect(home).toBeFocused();
    await expect(home.getByText('Default', { exact: true })).toBeVisible();
    await expectNoSidewaysScroll(page);
    expect(problems).toEqual([]);
  });

  test('when the map cannot load, the form still works with the address as found (S4.5)', async ({
    page,
  }) => {
    await page.route('https://tiles.openfreemap.org/**', (route) => route.abort());
    await signUp(page);
    await open(page, '/account/addresses/new');
    await pickAddress(page, '1 Faneuil Hall Square Boston', /Boston/);
    await expect(page.getByText('Map unavailable right now')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("We'll use the address as found.")).toBeVisible();
    await expect(page.getByRole('application')).toHaveCount(0);
    // No pin to move, so no line asking to move it (5.6).
    await expect(page.getByText('Not exactly right? Move the pin to your door.')).toHaveCount(0);
    await expect(result(page)).toHaveText(INSIDE, { timeout: 20_000 });
    await page.getByRole('button', { name: 'Save address' }).click();
    await expect(page).toHaveURL(/\/account\/addresses$/, { timeout: 20_000 });
    await expect(page.getByRole('article', { name: 'Home' })).toBeFocused();
  });

  test('a half-filled address survives a sign-out in another tab and is back after signing in (S2.12, S5.8)', async ({
    page,
    context,
  }) => {
    test.setTimeout(150_000);
    const account = await signUp(page);
    await open(page, '/account/addresses/new');
    await pickAddress(page, '1 Faneuil Hall Square Boston', /Boston/);
    await expect(result(page)).toHaveText(INSIDE, { timeout: 20_000 });
    const apt = page.getByLabel('Apt, suite or floor (optional)');
    const notes = page.getByLabel('Instructions for the courier (optional)');
    await apt.fill('Draft apt 9');
    await notes.fill('Ring twice');

    const other = await context.newPage();
    await open(other, '/');
    await signOutFromHeader(other);

    // Not sent to sign in at once: the next action shows the signed-out state (S5.8).
    await page.bringToFront();
    await page.waitForTimeout(1_500);
    await expect(page).toHaveURL(/\/account\/addresses\/new$/);
    await expect(apt).toHaveValue('Draft apt 9');

    await page.getByRole('button', { name: 'Save address' }).click();
    await expect(page.getByRole('main').getByText(SESSION_ENDED)).toBeVisible();
    expect(await savedDrafts(page)).toEqual(['foodz.draft:/account/addresses/new']);
    await page.getByRole('main').getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(
      /\/sign-in\?callbackUrl=%2Faccount%2Faddresses%2Fnew&notice=session-ended$/,
    );
    await expect(page.locator(':focus')).toContainText(SESSION_ENDED);
    // A fresh page: no header or welcome left over from the ended session.
    await expect(page.locator('header').getByRole('link', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Account menu for / })).toHaveCount(0);

    await page.getByLabel('Email').fill(account.email);
    await page.getByLabel('Password', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Back on the form with the pick, the apartment and the note, checked again.
    await expect(page).toHaveURL(/\/account\/addresses\/new$/, { timeout: 30_000 });
    await expect(apt).toHaveValue('Draft apt 9');
    await expect(notes).toHaveValue('Ring twice');
    await expect(page.getByRole('combobox', { name: 'Address' })).toHaveValue(/Faneuil Hall/);
    await expect(result(page)).toHaveText(INSIDE, { timeout: 20_000 });
    expect(await savedDrafts(page)).toEqual([]);
    await page.getByRole('button', { name: 'Save address' }).click();
    await expect(page).toHaveURL(/\/account\/addresses$/, { timeout: 20_000 });
    await expect(page.getByRole('article', { name: 'Home' })).toContainText('Draft apt 9');
  });

  test('an address nobody can find says so, and the search keeps what was typed (S4.16)', async ({
    page,
  }) => {
    await signUp(page);
    await open(page, '/account/addresses/new');
    const field = page.getByRole('combobox', { name: 'Address' });
    await field.pressSequentially('Qzxqzx Vbnmvbnm', { delay: 25 });
    const notFound = "We couldn't find that address. Check the spelling or try a nearby street.";
    await expect(page.getByRole('main').getByText(notFound)).toBeVisible({ timeout: 20_000 });
    await expect(liveRegion(page)).toHaveText(notFound);
    await expect(field).toHaveValue('Qzxqzx Vbnmvbnm');
    await expect(result(page)).toHaveText("We'll check delivery as soon as you pick an address.");
  });

  test('a made-up or malformed address id is a 404 with a way back (S4.14)', async ({ page }) => {
    await signUp(page);
    for (const id of ['01900000-0000-7000-8000-000000000000', 'not-an-id']) {
      const response = await page.goto(`/account/addresses/${id}`);
      expect(response?.status()).toBe(404);
      await expect(
        page.getByRole('heading', { level: 1, name: 'Address not found' }),
      ).toBeVisible();
      await expect(page.getByRole('link', { name: 'Back to addresses' }).first()).toBeVisible();
    }
  });
});
