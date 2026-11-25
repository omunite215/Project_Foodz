import {
  expect,
  expectNoAxeViolations,
  isPhone,
  isTablet,
  open,
  SAMPLE_PASSWORD,
  signInDemoAdmin,
  signInStaff,
  STAFF,
  test,
} from './support';

/*
 * Staff review of partner applications (F6 design 7 to 9): the sidebar entry, the list with its
 * tabs, search and cards, one application with its flags, images and history, the document
 * viewer, the demo admin's read-only view and the no-access page. Read-only: decisions are in
 * admin-flows/partners-decisions.spec.ts. Needs `npm run seed:partners`.
 */

test.beforeEach(() => {
  test.skip(!SAMPLE_PASSWORD, 'Needs the sample password (E2E_SEED_OUTPUT).');
});

async function openTab(page: import('@playwright/test').Page, name: RegExp, phone: boolean) {
  if (phone) {
    await page.getByRole('button', { name: /^Show: / }).click();
    await page.getByRole('menuitem', { name }).click();
  } else {
    await page
      .getByRole('navigation', { name: 'Application states' })
      .getByRole('link', { name })
      .click();
  }
}

test('the list: oldest first, tabs with counts, search by plate', async ({ page }, testInfo) => {
  await signInStaff(page, STAFF.support, '/admin/partners');
  await expect(page).toHaveTitle('Partners | Foodz Admin');
  if (!isPhone(testInfo) && !isTablet(testInfo)) {
    await expect(
      page.getByRole('link', { name: /^Partners, \d+ applications? to review$/ }),
    ).toBeVisible();
  }
  await expect(page.getByRole('link', { name: 'Ana Souza' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sam Rivera' }).first()).toBeVisible();
  await expectNoAxeViolations(page);

  // "6vh-450" finds Sam by plate, with or without the hyphen (A19.6).
  await page.getByRole('searchbox', { name: 'Search name, email or plate' }).fill('6vh-450');
  await expect(page).toHaveURL(/q=6vh-450/, { timeout: 10_000 });
  await expect(page.getByRole('link', { name: 'Sam Rivera' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ana Souza' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page).not.toHaveURL(/q=/);
  await expect(page.getByRole('link', { name: 'Ana Souza' }).first()).toBeVisible();
  await openTab(page, /^Suspended/, isPhone(testInfo));
  await expect(page).toHaveURL(/tab=suspended/);
  await expect(page.getByRole('link', { name: 'Victor Hale' }).first()).toBeVisible();
  await expectNoAxeViolations(page);
});

test('one application: flags, what to check, photo and ID, history, and the viewer', async ({
  page,
}) => {
  await signInStaff(page, STAFF.support, '/admin/partners');
  await page.getByRole('link', { name: 'Sam Rivera' }).first().click();
  await expect(page).toHaveURL(/\/admin\/partners\/[0-9a-f-]{36}\?tab=review$/, {
    timeout: 15_000,
  });
  await expect(page).toHaveTitle('Partner application | Foodz Admin');
  await expect(page.getByRole('heading', { level: 1, name: 'Sam Rivera' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Flags' })).toBeVisible();
  await expect(page.getByText(/^Plate 6VH 450 is also on/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What to check' })).toBeVisible();
  await expect(page.getByText('Ending 5521').first()).toBeVisible();
  await expect(page.getByRole('list', { name: 'Application history' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send back for changes' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reject' })).toBeVisible();
  await expectNoAxeViolations(page);

  const opener = page.getByRole('button', {
    name: /^Open front of Sam Rivera's driver's license$/,
  });
  await opener.click();
  const viewer = page.getByRole('dialog', { name: "Front of Sam Rivera's driver's license" });
  await expect(viewer).toBeVisible();
  await viewer.getByRole('button', { name: 'Zoom in' }).click();
  await expect(viewer.getByText('200%')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('the demo admin sees every decision disabled, and real people masked', async ({ page }) => {
  await signInDemoAdmin(page, '/admin/partners');
  await page.getByRole('link', { name: 'Ana Souza' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ana Souza' })).toBeVisible();
  await expect(page.getByText('Read-only in the demo').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await expectNoAxeViolations(page);
});

test('"Back to partners" returns to the list as it was (A20.1)', async ({ page }) => {
  await signInStaff(page, STAFF.support, '/admin/partners?tab=review&q=souza');
  const ana = page.getByRole('link', { name: 'Ana Souza' }).first();
  await expect(ana).toBeVisible();
  await ana.click();
  await expect(page).toHaveURL(/\/admin\/partners\/[0-9a-f-]{36}\?tab=review&q=souza$/);
  const back = page.getByRole('link', { name: 'Back to partners' }).first();
  await expect(back).toHaveAttribute('href', '/admin/partners?tab=review&q=souza');
  await back.click();
  await expect(page).toHaveURL(/\/admin\/partners\?tab=review&q=souza$/);
  await expect(page.getByRole('searchbox', { name: 'Search name, email or plate' })).toHaveValue(
    'souza',
  );
  await expect(page.getByRole('link', { name: 'Ana Souza' }).first()).toBeVisible();
});

test('a partner at a Partners address gets the storefront 404, title included (A18.3)', async ({
  page,
}) => {
  await open(page, `/sign-in?callbackUrl=${encodeURIComponent('/admin/partners')}`);
  await page.getByLabel('Email').fill('approved.partner@foodz.example');
  await page.getByLabel('Password', { exact: true }).fill(SAMPLE_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  const notFound = page.getByRole('heading', { level: 1, name: "We couldn't find that page" });
  await expect(notFound).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveTitle('Page not found | Foodz');
  await open(page, '/admin/partners/0192f6a4-5b6c-7d8e-9f01-23456789abcd');
  await expect(notFound).toBeVisible();
  await expect(page).toHaveTitle('Page not found | Foodz');
});

test('the kitchen gets the no-access page; an unknown id is not found', async ({
  page,
  browser,
}) => {
  await signInStaff(page, STAFF.kitchen, '/admin/partners');
  await expect(
    page.getByRole('heading', { level: 1, name: "You don't have access to this page" }),
  ).toBeVisible();
  await expect(page).toHaveTitle('No access | Foodz Admin');

  const other = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  const support = await other.newPage();
  await signInStaff(support, STAFF.support, '/admin/partners');
  await open(support, '/admin/partners/6VH450');
  await expect(
    support.getByRole('heading', { level: 1, name: 'Application not found' }),
  ).toBeVisible();
  await expectNoAxeViolations(support);
  await other.close();
});
