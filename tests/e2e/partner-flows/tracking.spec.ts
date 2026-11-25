import type { Browser, Page } from '@playwright/test';
import { ACCOUNTS, signIn } from '../account/support';
import { card, codeFor, STAFF } from '../admin/support';
import {
  expect,
  expectNoAxeViolations,
  expectNoAxeViolationsAtEnd,
  open,
  ROUTE,
  SAMPLE_PASSWORD,
  signInTo,
  test,
} from '../partner/support';

/*
 * One delivery from the offer to the door (F8 P37 to P44, S1 to S4): the pick-up screen with
 * the map and the counter card, Open in Maps and its once-per-delivery warning, the pickup
 * slide, the deliver screen with the customer's first name, the code on her order page, a
 * wrong code, the right one, and everything gone from her page after the delivery. Omar takes
 * S1105 (left ready by the F7 suite, or marked ready here). It runs after the partner projects
 * (playwright.config.ts) and checks 360, 375 and 1440 px on the way.
 */

const OMAR = { email: 'omar.partner@foodz.example', name: 'Omar Haddad', first: 'Omar' };
const ORDER = 'S1105';

test.beforeEach(() => {
  test.skip(!SAMPLE_PASSWORD, 'Needs the sample password (E2E_SEED_OUTPUT).');
});

async function staffPage(browser: Browser, email: string, baseURL: string | undefined) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL });
  const page = await context.newPage();
  await open(page, `/sign-in?callbackUrl=${encodeURIComponent('/admin/orders')}`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(SAMPLE_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  const code = page.getByLabel('6-digit code');
  if (
    await code.waitFor({ timeout: 15_000 }).then(
      () => true,
      () => false,
    )
  ) {
    await code.fill(await codeFor(email));
    await page.getByRole('button', { name: 'Continue' }).click();
  }
  await page.waitForURL((url) => url.pathname.startsWith('/admin'), { timeout: 30_000 });
  await open(page, '/admin/orders');
  return { context, page };
}

/** The kitchen moves the order on until it's ready, if it isn't yet. */
async function makeReady(board: Page) {
  for (const step of ['Accept', 'Start cooking', 'Mark ready']) {
    const button = card(board, ORDER).getByRole('button', { name: new RegExp(`^${step} order`) });
    if (await button.isVisible()) {
      await button.click();
      await expect(card(board, ORDER).getByRole('button', { name: /^Undo/ })).toBeVisible();
    }
  }
}

test('a courier picks up, finds the door with the map and hands over with the code', async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  test.setTimeout(420_000);

  const kitchen = await staffPage(browser, STAFF.kitchen, baseURL);
  await expect(card(kitchen.page, ORDER)).toBeVisible({ timeout: 20_000 });
  await makeReady(kitchen.page);
  await kitchen.context.close();

  // Omar goes online at the kitchen.
  await signInTo(page, OMAR.email);
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ ...ROUTE.R0, accuracy: 15 });
  await open(page, '/partner');
  if (!(await page.getByRole('button', { name: 'Go offline' }).isVisible())) {
    await page.getByRole('button', { name: /^Go online/ }).click();
  }
  await expect(page.getByRole('heading', { name: 'Waiting for orders' })).toBeVisible({
    timeout: 20_000,
  });

  // Support offers him the order; he accepts with the keyboard.
  const support = await staffPage(browser, STAFF.support, baseURL);
  const order = card(support.page, ORDER);
  await order.getByRole('button', { name: new RegExp(`actions for order ${ORDER}`, 'i') }).click();
  await support.page.getByRole('menuitem', { name: 'Assign courier' }).click();
  const assign = support.page.getByRole('dialog', { name: `Assign a courier to order ${ORDER}` });
  await assign.getByRole('radio', { name: new RegExp(`^${OMAR.name},`) }).check();
  await assign.getByRole('button', { name: 'Send offer' }).click();
  await expect(assign).toHaveCount(0);
  const href = await card(support.page, ORDER).locator('h3 a').getAttribute('href');
  const offer = page.getByRole('dialog', { name: 'New order offer' });
  await expect(offer).toBeVisible({ timeout: 20_000 });
  await offer.getByRole('button', { name: /Accept order, earn/ }).focus();
  await page.keyboard.press('Enter');

  // The pick-up screen: the map to the kitchen with Open in Maps, the slider in the dock.
  const pickUp = page.getByRole('heading', { level: 1, name: `Pick up order ${ORDER}` });
  await expect(pickUp).toBeVisible({ timeout: 20_000 });
  // Its name starts with what it shows, so it changes with the state (WCAG 2.5.3).
  const slider = page.getByRole('button', { name: new RegExp(`picked up order ${ORDER}$`) });
  await expect(slider).toHaveAccessibleName(
    `Slide when you have the food, picked up order ${ORDER}`,
  );
  expect((await slider.boundingBox())?.height).toBeGreaterThanOrEqual(56);

  // At the kitchen (within 100 m), the map gives way to the counter card (P37.3).
  const counter = page
    .getByRole('region', { name: 'At the kitchen' })
    .getByText(`You're at the kitchen. Show order number ${ORDER} at the counter.`);
  const mapsLink = page.getByRole('link', { name: 'Open in Maps, directions to Foodz Kitchen' });
  if (await mapsLink.isVisible()) {
    // The first press per delivery asks first (U10); "Stay in Foodz" goes back to it.
    await mapsLink.click();
    const warning = page.getByRole('alertdialog', { name: 'Open another maps app?' });
    await expect(warning.getByText(/Foodz can't see you coming/)).toBeVisible();
    await expectNoAxeViolations(page);
    await warning.getByRole('button', { name: 'Stay in Foodz' }).click();
    await expect(mapsLink).toBeFocused();
  }
  await expect(counter).toBeVisible({ timeout: 60_000 });
  await expectNoAxeViolationsAtEnd(page);

  // One tap path (F7 review B1): a tap arms it at once, a second within 3 s confirms.
  await slider.click();
  await expect(slider).toHaveAccessibleName(`Tap again to confirm, picked up order ${ORDER}`);
  await page.waitForTimeout(1_000);
  await slider.click();
  const deliverHeading = page.getByRole('heading', { level: 1, name: `Deliver order ${ORDER}` });
  await expect(deliverHeading).toBeVisible({ timeout: 20_000 });
  await expect(deliverHeading).toBeFocused();
  await expect(page).toHaveTitle(`Deliver order ${ORDER} | Foodz Partner`);

  // Only now the customer: first name, address, the call button (P39).
  const dropoff = page.getByRole('region', { name: 'Drop-off' });
  await expect(dropoff.getByText('Priya', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Call Priya, / })).toBeVisible();
  await expect(
    page.getByRole('link', { name: "Open in Maps, directions to Priya's door" }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Problem with this delivery' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Go offline' })).toHaveCount(0);
  await expectNoAxeViolationsAtEnd(page);
  await page.setViewportSize({ width: 360, height: 760 });
  await expectNoAxeViolationsAtEnd(page);

  // Priya's page: the code card, the map card, no announcement bar (S1, S3).
  const customer = await browser.newContext({ viewport: { width: 375, height: 812 }, baseURL });
  const priya = await customer.newPage();
  await signIn(priya, ACCOUNTS.second, SAMPLE_PASSWORD);
  await open(priya, `/orders/${href?.split('/').at(-1) ?? ''}`);
  const codeCard = priya.getByRole('region', { name: 'Your delivery code' });
  await expect(codeCard).toBeVisible({ timeout: 20_000 });
  const spoken = (await codeCard.locator('.sr-only').first().textContent()) ?? '';
  const code = spoken.replace(/\D/g, '');
  expect(code).toMatch(/^\d{4}$/);
  await expect(priya.getByRole('region', { name: `Where ${OMAR.first} is` }).first()).toBeVisible();
  await expectNoAxeViolations(priya);
  await priya.setViewportSize({ width: 1440, height: 900 });
  await expect(priya.getByRole('complementary', { name: 'Your delivery' })).toBeVisible();
  await expectNoAxeViolations(priya);

  // A wrong code: the boxes clear, the server's tries, said assertively (P42).
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole('button', { name: 'Enter delivery code' }).click();
  const sheet = page.getByRole('dialog', { name: "Enter Priya's delivery code" });
  await expect(sheet).toBeVisible();
  const cash = sheet.getByRole('checkbox', { name: /^I collected \$/ });
  if (await cash.isVisible()) await cash.check();
  const wrong = code === '1357' ? '2468' : '1357';
  const box = sheet.getByRole('textbox', { name: 'Delivery code, 4 digits' });
  await box.fill(wrong);
  await sheet.getByRole('button', { name: 'Complete delivery' }).click();
  await expect(
    sheet.getByText(
      "That code doesn't match. Ask Priya to read it from the order page. 4 tries left.",
    ),
  ).toBeVisible();
  await expect(box).toHaveValue('');
  await expectNoAxeViolations(page);

  // The right code: delivered, with the pay (P41.3).
  await box.fill(code);
  await sheet.getByRole('button', { name: 'Complete delivery' }).click();
  await expect(sheet.getByRole('heading', { name: `Order ${ORDER} delivered` })).toBeVisible({
    timeout: 20_000,
  });
  await expect(sheet.getByText(/^You earned/)).toBeVisible();
  await sheet.getByRole('button', { name: 'Back to waiting' }).click();
  await expect(page.getByRole('heading', { name: 'Waiting for orders' })).toBeVisible();

  // Her page: the code and the map are gone within moments (S4.3, S6.1).
  await expect(codeCard).toHaveCount(0, { timeout: 20_000 });
  await expect(priya.getByRole('region', { name: `Where ${OMAR.first} is` })).toHaveCount(0);

  await page.getByRole('button', { name: 'Go offline' }).click();
  await customer.close();
  await support.context.close();
});
