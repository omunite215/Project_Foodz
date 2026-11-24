import { execSync } from 'node:child_process';
import {
  codeFor,
  expect,
  expectNoAxeViolations,
  SAMPLE_PASSWORD,
  signInStaff,
  STAFF,
  test,
} from '../admin/support';

/*
 * Decisions on partner applications (F6 design 10, A23 to A25): Morgan (SUPPORT) sends Ana back,
 * rejects Kwame and approves Sam past his flags with a code, then suspends Diego. They change the
 * partner fixtures for good, so they reset them first and run one viewport at a time.
 */

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  execSync('npm run seed:partners', { stdio: 'ignore', env: process.env, timeout: 120_000 });
});

test.beforeEach(() => {
  test.skip(!SAMPLE_PASSWORD, 'Needs the sample password (E2E_SEED_OUTPUT).');
});

test('send back, with a starter sentence, then the result line', async ({ page }) => {
  await signInStaff(page, STAFF.support, '/admin/partners');
  await page.getByRole('link', { name: 'Ana Souza' }).first().click();
  await page.getByRole('button', { name: 'Send back for changes' }).click();
  const dialog = page.getByRole('dialog', { name: "Send Ana Souza's application back?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /^The photo of your ID is blurry/ }).click();
  await expect(dialog.getByLabel('What needs fixing')).toHaveValue(
    /^The photo of your ID is blurry/,
  );
  // The dialog has finished fading in before contrast is measured.
  await expect(dialog).toHaveCSS('opacity', '1');
  await expectNoAxeViolations(page);
  await dialog.getByRole('button', { name: 'Send back', exact: true }).click();
  await expect(
    page.getByRole('main').getByText("Sent back to Ana Souza. We've emailed Ana."),
  ).toBeVisible({
    timeout: 15_000,
  });
  // The result line takes focus (design 8.10).
  await expect(page.locator(':focus')).toContainText("Sent back to Ana Souza. We've emailed Ana.");
});

test('reject needs no code; approve past flags needs the tick and a code', async ({ page }) => {
  await signInStaff(page, STAFF.support, '/admin/partners?tab=waiting');
  await page.getByRole('link', { name: 'Kwame Mensah' }).first().click();
  await page.getByRole('button', { name: 'Reject' }).click();
  const reject = page.getByRole('dialog', { name: "Reject Kwame Mensah's application?" });
  await reject.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(
    page
      .getByRole('main')
      .getByText("Kwame Mensah's application is rejected. We've emailed Kwame."),
  ).toBeVisible({
    timeout: 15_000,
  });

  await page.goto('/admin/partners');
  await page.getByRole('link', { name: 'Sam Rivera' }).first().click();
  await page.getByRole('button', { name: 'Approve' }).click();
  const approve = page.getByRole('dialog', { name: 'Approve Sam Rivera?' });
  await expect(approve.getByText('Flags', { exact: true })).toBeVisible();
  await approve.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(
    approve.getByText('Check this box to approve an application with flags.'),
  ).toBeVisible();
  await approve.getByRole('checkbox', { name: "I've checked these flags" }).check();
  const code = approve.getByLabel('6-digit code from your authenticator app');
  // A code only when the last check is over 10 minutes old (A27.1): fresh sign-ins skip it.
  const outcome = page
    .getByRole('main')
    .getByText(/Sam Rivera is approved\. We've emailed Sam\./)
    .or(approve.getByText(/still being checked|missing from storage/));
  if (!(await code.isVisible())) {
    await approve.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(code.or(outcome)).toBeVisible({ timeout: 15_000 });
  }
  if (await code.isVisible()) {
    await code.fill(await codeFor(STAFF.support));
    await approve.getByRole('button', { name: 'Approve', exact: true }).click();
  }
  // Sam's license expires in 20 days: approved, or refused for an image still being checked.
  await expect(
    page
      .getByRole('main')
      .getByText(
        /Sam Rivera is approved\. We've emailed Sam\.|still being checked|missing from storage/,
      ),
  ).toBeVisible({ timeout: 15_000 });
});

test('suspend takes Diego offline at once', async ({ page }) => {
  await signInStaff(page, STAFF.support, '/admin/partners?tab=approved');
  await page.getByRole('link', { name: 'Diego Alvarez' }).first().click();
  await page.getByRole('button', { name: 'Suspend' }).click();
  const dialog = page.getByRole('dialog', { name: 'Suspend Diego Alvarez?' });
  await expect(dialog.getByText('This takes effect at once.')).toBeVisible();
  await expect(dialog.getByText('Diego is offline.')).toBeVisible({ timeout: 10_000 });
  const code = dialog.getByLabel('6-digit code from your authenticator app');
  if (await code.isVisible()) await code.fill(await codeFor(STAFF.support));
  await dialog.getByRole('button', { name: 'Suspend', exact: true }).click();
  await expect(
    page
      .getByRole('main')
      .getByText("Diego Alvarez is suspended and offline. We've emailed Diego."),
  ).toBeVisible({
    timeout: 15_000,
  });
});
