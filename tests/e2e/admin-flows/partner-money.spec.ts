import { execSync } from 'node:child_process';
import type { Locator, Page } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_PASSWORD, adminTotpSecret, freshTotp, open } from '../account/support';
import {
  expect,
  expectNoAxeViolations,
  SAMPLE_PASSWORD,
  signInStaff,
  STAFF,
  test,
} from '../admin/support';

/*
 * F9's staff money and ratings actions (design 3.6 to 3.11): Morgan (SUPPORT) records Diego's
 * cash, Daniel (ADMIN) adjusts Luis's earnings and records the payout, and Morgan excludes one
 * of Grace's ratings and includes it again. They change the fixtures for good, so they reset
 * them first (`seed:partners` then `seed:earnings`) and run one viewport at a time (the
 * admin-flows projects, E2E_ADMIN=1). ADMIN needs SEED_ADMIN_PASSWORD and the admin
 * authenticator in E2E_SEED_OUTPUT.
 */

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  execSync('npm run seed:partners', { stdio: 'ignore', env: process.env, timeout: 120_000 });
  execSync('npm run seed:earnings', { stdio: 'ignore', env: process.env, timeout: 180_000 });
});

test.beforeEach(() => {
  test.skip(!SAMPLE_PASSWORD, 'Needs the sample password (E2E_SEED_OUTPUT).');
});

const APPROVED = '/admin/partners?tab=approved';

async function openPartner(page: Page, name: string) {
  await page.getByRole('link', { name, exact: true }).first().click();
  await expect(page).toHaveURL(/\/admin\/partners\/[0-9a-f-]{36}\?tab=approved/, {
    timeout: 15_000,
  });
}

/** The seeded ADMIN: password, then a fresh authenticator code. */
async function signInAdmin(page: Page, secret: string, path: string) {
  await open(page, `/sign-in?callbackUrl=${encodeURIComponent(path)}`);
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  const code = page.getByLabel('6-digit code');
  await code.waitFor({ timeout: 30_000 });
  await code.fill(await freshTotp(secret));
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 30_000 });
  await page.waitForLoadState('networkidle');
}

/** Step-up is asked only when the last check is over 10 minutes old (A61.1). */
async function submitWithStepUp(dialog: Locator, action: RegExp, secret: string) {
  const code = dialog.getByLabel('6-digit code from your authenticator app');
  if (await code.isVisible()) await code.fill(await freshTotp(secret));
  await dialog.getByRole('button', { name: action }).click();
  // A late step-up answer shows the field with focus; fill it and send again.
  const asked = await code
    .waitFor({ state: 'visible', timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
  if (asked && !(await code.inputValue())) {
    await code.fill(await freshTotp(secret));
    await dialog.getByRole('button', { name: action }).click();
  }
}

test('SUPPORT records cash Diego hands in', async ({ page }) => {
  await signInStaff(page, STAFF.support, APPROVED);
  await openPartner(page, 'Diego Alvarez');
  const opener = page.getByRole('button', { name: 'Record cash handed in' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Record cash from Diego Alvarez' });
  await expect(dialog).toBeVisible();
  // It starts at what Diego owes, and previews the balance in words (A60.2).
  const amount = dialog.getByLabel('Amount');
  await expect(amount).toHaveValue('142.70');
  await expect(dialog.getByText("Diego is holding $164.80 in customers' cash.")).toBeVisible();
  await expect(dialog.getByText('After this, Diego is all square.')).toBeVisible();
  await expect(dialog).toHaveCSS('opacity', '1');
  await expectNoAxeViolations(page);

  // More than he holds is refused under the field, on blur.
  await amount.fill('200');
  await amount.blur();
  await expect(
    dialog.getByText('Diego is holding $164.80, so enter $164.80 or less.'),
  ).toBeVisible();
  await amount.fill('142.70');
  await dialog.getByRole('button', { name: 'Record $142.70' }).click();

  await expect(page.getByText('Recorded $142.70 in cash from Diego A.')).toBeVisible({
    timeout: 15_000,
  });
  await expect(dialog).toBeHidden();
  await expect(page.getByText('All square', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Holding $22.10 in customers' cash")).toBeVisible();
  await expect(page.getByText('Cash handed in').first()).toBeVisible();
});

test('ADMIN adjusts Luis, then records the payout that clears the balance', async ({ page }) => {
  const secret = adminTotpSecret();
  test.skip(
    !secret || !ADMIN_PASSWORD,
    'Needs SEED_ADMIN_PASSWORD and the admin authenticator in E2E_SEED_OUTPUT.',
  );
  await signInAdmin(page, secret ?? '', APPROVED);
  await openPartner(page, 'Luis Moreno');
  await expect(page.getByText('Foodz owes Luis $67.05')).toBeVisible();

  // Adjust: add $3.00 for waiting, with a message Luis reads exactly as typed.
  await page.getByRole('button', { name: 'Adjust earnings' }).click();
  const adjust = page.getByRole('dialog', { name: "Adjust Luis Moreno's earnings" });
  await expect(adjust).toBeVisible();
  await adjust.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(adjust.getByText('Choose a reason.')).toBeVisible();
  await expect(adjust.getByText('Write a message for Luis.')).toBeVisible();
  await adjust.getByLabel('Amount').fill('3');
  await adjust.getByRole('radio', { name: 'Correction' }).check();
  await adjust.getByLabel('Message for Luis').fill('Waited 20 min at the kitchen for order 1050.');
  await expect(
    adjust.getByText(
      'Luis will see: Foodz added $3.00: Waited 20 min at the kitchen for order 1050.',
    ),
  ).toBeVisible();
  await expect(adjust.getByText('After this, Foodz will owe Luis $70.05.')).toBeVisible();
  await submitWithStepUp(adjust, /^Add \$3\.00$/, secret ?? '');
  await expect(page.getByText("Added $3.00 to Luis M.'s earnings.")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText('Foodz owes Luis $70.05')).toBeVisible({ timeout: 15_000 });

  // Payout: records a payment made elsewhere, never twice.
  await page.getByRole('button', { name: 'Record payout' }).click();
  const payout = page.getByRole('dialog', { name: 'Record a payout to Luis Moreno' });
  await expect(payout).toBeVisible();
  await expect(payout.getByLabel('Amount')).toHaveValue('70.05');
  await payout.getByRole('radio', { name: 'Bank transfer' }).check();
  await payout.getByLabel('Reference (optional)').fill('Transfer 88213');
  await expect(
    payout.getByText('Luis will see: Foodz paid you $70.05 · Bank transfer'),
  ).toBeVisible();
  await expect(payout).toHaveCSS('opacity', '1');
  await expectNoAxeViolations(page);
  await submitWithStepUp(payout, /^Record \$70\.05 payout$/, secret ?? '');
  await expect(page.getByText('Recorded a payout of $70.05 to Luis M.')).toBeVisible({
    timeout: 15_000,
  });
  // The button gives way to its line; focus went to the balance (design 3.9).
  await expect(page.getByText('All square', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Foodz doesn't owe Luis anything right now.")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record payout' })).toHaveCount(0);
  await expect(page.locator('[data-balance-heading]')).toBeFocused();
});

test('SUPPORT excludes a rating with a reason, then includes it again', async ({ page }) => {
  await signInStaff(page, STAFF.support, APPROVED);
  await openPartner(page, 'Grace Okafor');
  await page
    .getByRole('navigation', { name: 'Partner sections' })
    .getByRole('link', { name: 'Ratings' })
    .click();
  const exclude = page.getByRole('button', {
    name: /^Exclude from average: 3 stars, .+, order S2205$/,
  });
  await exclude.click();
  const dialog = page.getByRole('dialog', {
    name: "Exclude this rating from Grace Okafor's average?",
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Exclude', exact: true }).click();
  await expect(dialog.getByText('Choose a reason.')).toBeVisible();
  await dialog.getByRole('radio', { name: 'Other' }).check();
  await dialog.getByRole('button', { name: 'Exclude', exact: true }).click();
  await expect(dialog.getByText('Add a note about why.')).toBeVisible();
  await dialog.getByRole('radio', { name: 'About the food, not the courier' }).check();
  await expect(dialog).toHaveCSS('opacity', '1');
  await expectNoAxeViolations(page);
  await dialog.getByRole('button', { name: 'Exclude', exact: true }).click();

  await expect(page.getByText("Rating excluded from Grace O.'s average.")).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByText(/^Excluded · About the food, not the courier · /).first(),
  ).toBeVisible();
  const include = page.getByRole('button', { name: /^Include again: 3 stars, .+, order S2205$/ });
  await expect(include).toBeFocused();

  // Include again acts at once and keeps focus on the row's button (A58.3).
  await include.click();
  await expect(page.getByText("Rating counts toward Grace O.'s average again.")).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByRole('button', { name: /^Exclude from average: 3 stars, .+, order S2205$/ }),
  ).toBeFocused();
});
