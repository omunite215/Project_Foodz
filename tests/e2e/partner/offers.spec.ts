import type { Browser, BrowserContext, Page, TestInfo } from '@playwright/test';
import { ACCOUNTS, asOwnNetwork, signIn } from '../account/support';
import { card, codeFor, STAFF } from '../admin/support';
import {
  expect,
  expectNoAxeViolations,
  expectNoAxeViolationsAtEnd,
  open,
  PARTNERS,
  projectOf,
  ROUTE,
  SAMPLE_PASSWORD,
  signInTo,
  test,
} from './support';

/*
 * Offers and the order a partner holds (F7 design 1, P19 to P34). Support sends a courier an
 * offer from the board; the courier accepts it on the phone, sees the pick-up screen, and is
 * told when support takes the order off. Each phone width uses its own courier and order, so
 * the projects never share one: 1440 Luis and S1107 (already ready), 375 Omar and S1105, 360
 * Lena and S1103 (the kitchen marks them ready first). Run `npm run seed:board` and
 * `npm run seed:partners` before each session.
 */

const COURIERS = {
  'partner-1440': {
    email: 'luis.partner@foodz.example',
    name: 'Luis Moreno',
    short: 'Luis M.',
    first: 'Luis',
    order: 'S1107',
    steps: [] as string[],
  },
  'partner-375': {
    email: 'omar.partner@foodz.example',
    name: 'Omar Haddad',
    short: 'Omar H.',
    first: 'Omar',
    order: 'S1105',
    steps: ['Mark ready'],
  },
  'partner-360': {
    email: 'lena.partner@foodz.example',
    name: 'Lena Fischer',
    short: 'Lena F.',
    first: 'Lena',
    order: 'S1103',
    steps: ['Start cooking', 'Mark ready'],
  },
} as const;

type Courier = (typeof COURIERS)[keyof typeof COURIERS];

const courierOf = (testInfo: TestInfo): Courier | null =>
  (COURIERS as Record<string, Courier>)[projectOf(testInfo)] ?? null;

test.beforeEach(() => {
  test.skip(!SAMPLE_PASSWORD, 'Needs the sample password (E2E_SEED_OUTPUT).');
});

/** A staff page at desktop width: the board's own widths are covered by tests/e2e/admin. */
async function staffPage(browser: Browser, email: string, baseURL: string | undefined) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL });
  // Its own network, so the per-network code limit (10 in 5 minutes) is never shared.
  await asOwnNetwork(context, baseURL);
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
  await page.waitForLoadState('networkidle');
  return { context, page };
}

async function goOnline(page: Page, context: BrowserContext) {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ ...ROUTE.R0, accuracy: 15 });
  // The app loads itself once as a partner document, so location is allowed.
  await open(page, '/partner');
  const online = page.getByRole('button', { name: /^Go online/ });
  const offline = page.getByRole('button', { name: 'Go offline' });
  if (await offline.isVisible()) return;
  await online.click();
  await expect(page.getByRole('heading', { name: 'Waiting for orders' })).toBeVisible({
    timeout: 20_000,
  });
}

/**
 * Support picks the courier in the assign dialog (A37). With a job runner attached, the
 * automatic search may first offer him an order another project marked ready: his row then reads
 * "Has another offer open" (A37.2), so he declines that one and support refreshes the list. An
 * automatic offer of this same order doesn't block him: support's offer replaces it (A37.3).
 */
async function sendOffer(board: Page, phone: Page, number: string, courierName: string) {
  const order = card(board, number);
  await expect(order).toBeVisible({ timeout: 20_000 });
  await order.getByRole('button', { name: new RegExp(`actions for order ${number}`, 'i') }).click();
  await board.getByRole('menuitem', { name: 'Assign courier' }).click();
  const dialog = board.getByRole('dialog', { name: `Assign a courier to order ${number}` });
  await expect(dialog).toBeVisible();
  const choice = dialog.getByRole('radio', { name: new RegExp(`^${courierName},`) });
  await expect(choice).toBeVisible({ timeout: 10_000 });
  for (let attempt = 0; attempt < 3 && !(await choice.isEnabled()); attempt += 1) {
    const other = phone.getByRole('dialog', { name: 'New order offer' });
    if (await other.isVisible()) {
      await other.getByRole('button', { name: 'Decline order' }).click();
      await expect(other).toHaveCount(0);
    }
    await dialog.getByRole('button', { name: 'Refresh list' }).click();
    await expect(choice)
      .toBeEnabled({ timeout: 5_000 })
      .catch(() => undefined);
  }
  await choice.check();
  await dialog.getByRole('button', { name: 'Send offer' }).click();
  await expect(dialog).toHaveCount(0);
}

test('a courier takes an offer from support, picks up, and is taken off', async ({
  page,
  context,
  browser,
  baseURL,
}, testInfo) => {
  const courier = courierOf(testInfo);
  test.skip(!courier, 'One courier per phone width.');
  if (!courier) return;
  test.setTimeout(240_000);

  // The kitchen marks the order ready where it isn't yet.
  if (courier.steps.length) {
    const kitchen = await staffPage(browser, STAFF.kitchen, baseURL);
    for (const step of courier.steps) {
      await card(kitchen.page, courier.order)
        .getByRole('button', { name: new RegExp(`^${step} order`) })
        .click();
      await expect(
        card(kitchen.page, courier.order).getByRole('button', { name: /^Undo/ }),
      ).toBeVisible();
    }
    await kitchen.context.close();
  }

  // "How offers work" can be read before going online (lead decision 2).
  await signInTo(page, courier.email);
  await open(page, '/partner');
  await page.getByRole('button', { name: 'How offers work' }).click();
  const rules = page.getByRole('dialog', { name: 'How offers work' });
  await expect(rules.getByText(/^You have \d+ seconds to answer\./)).toBeVisible();
  await expectNoAxeViolations(page);
  await rules.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('button', { name: 'How offers work' })).toBeFocused();

  await goOnline(page, context);

  // Support sends the offer from the board (A37).
  const support = await staffPage(browser, STAFF.support, baseURL);
  await sendOffer(support.page, page, courier.order, courier.name);
  await expect(
    card(support.page, courier.order)
      .getByText(new RegExp(`offered it to ${courier.short}`))
      .first(),
  ).toBeVisible({ timeout: 20_000 });

  // The offer covers the phone (P19.1): band, countdown, pay, facts, Decline above the slider.
  const offer = page.getByRole('dialog', { name: 'New order offer' });
  await expect(offer).toBeVisible({ timeout: 20_000 });
  await expect(offer.getByText('Foodz support picked you for this order.')).toBeVisible();
  await expect(offer.getByText('You earn', { exact: true })).toBeVisible();
  await expect(offer.getByText(/^Boston 02109 · \d+\.\d km from the kitchen$/)).toBeVisible();
  const accept = offer.getByRole('button', { name: /Accept order, earn \$\d+\.\d{2}$/ });
  await expect(accept).toBeVisible();
  const decline = offer.getByRole('button', { name: 'Decline order' });
  const [declineBox, acceptBox] = [await decline.boundingBox(), await accept.boundingBox()];
  expect(declineBox && acceptBox && declineBox.y < acceptBox.y).toBe(true);
  expect(acceptBox?.height).toBeGreaterThanOrEqual(56);
  // Escape never declines (lead decision 3).
  await page.keyboard.press('Escape');
  await expect(offer).toBeVisible();
  await expectNoAxeViolations(page);

  // On short and common phones the band shows its heading and kind line in full, and the payment
  // row (Lena's order is cash) ends above Decline (design 1.2, review B2 and S5).
  if (projectOf(testInfo) === 'partner-360') {
    const before = page.viewportSize();
    for (const size of [
      { width: 320, height: 568 },
      { width: 375, height: 812 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(size);
      const title = offer.getByRole('heading', { name: 'New order offer' });
      const kindLine = offer.getByText('Foodz support picked you for this order.');
      const band = title.locator('xpath=..');
      const [bandBox, titleBox, kindBox] = await Promise.all([
        band.boundingBox(),
        title.boundingBox(),
        kindLine.boundingBox(),
      ]);
      if (!bandBox || !titleBox || !kindBox) throw new Error('No band');
      expect(titleBox.y + titleBox.height).toBeLessThanOrEqual(bandBox.y + bandBox.height);
      expect(kindBox.y + kindBox.height).toBeLessThanOrEqual(bandBox.y + bandBox.height);
      const payment = offer.getByText(/^Cash order · collect \$/);
      const [paymentBox, declineTop] = [await payment.boundingBox(), await decline.boundingBox()];
      if (!paymentBox || !declineTop) throw new Error('No payment row');
      expect(
        paymentBox.y + paymentBox.height,
        `${size.width} × ${size.height}`,
      ).toBeLessThanOrEqual(declineTop.y);
    }
    await page.setViewportSize({ width: 320, height: 568 });
    await expectNoAxeViolations(page);
    if (before) await page.setViewportSize(before);
  }

  // Each width accepts its own way: the keyboard, two taps, or a slide past 80% (P22).
  if (projectOf(testInfo) === 'partner-360') {
    await accept.focus();
    await page.keyboard.press('Enter');
  } else if (projectOf(testInfo) === 'partner-375') {
    // Two taps a second apart (U13): the first arms at once, the second accepts (review B1).
    await accept.click();
    await expect(offer.getByText('Tap again to accept', { exact: true })).toBeVisible();
    await page.waitForTimeout(1_000);
    await accept.click();
  } else {
    const box = await accept.boundingBox();
    if (!box) throw new Error('No slider');
    await page.mouse.move(box.x + 28, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 8 });
    await page.mouse.move(box.x + box.width - 10, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
  }
  await expect(offer.getByText(`Order ${courier.order} is yours`)).toBeVisible({ timeout: 15_000 });

  // The pick-up screen (P29.1), in the page's title too.
  const heading = page.getByRole('heading', { level: 1, name: `Pick up order ${courier.order}` });
  await expect(heading).toBeVisible({ timeout: 15_000 });
  await expect(heading).toBeFocused();
  await expect(page).toHaveTitle(`Pick up order ${courier.order} | Foodz Partner`);
  // The accepted card fades out over the screen; its own rows read "you're at the kitchen" too.
  await expect(offer).toHaveCount(0);
  await expect(page.getByText('Foodz Kitchen · 88 Harbor Street')).toBeVisible();
  await expect(page.getByText("You're at the kitchen")).toBeVisible();
  const maps = page.getByRole('link', { name: /^Open in Maps for directions to Foodz Kitchen$/ });
  await expect(maps).toHaveAttribute(
    'href',
    courier.first === 'Lena'
      ? /travelmode=bicycling/
      : /google\.com\/maps\/dir\/.*travelmode=driving/,
  );
  await expect(page.getByRole('link', { name: /^Call Foodz Kitchen, / })).toBeVisible();
  await expect(page.getByRole('button', { name: "Can't do this delivery" })).toBeVisible();
  await expectNoAxeViolationsAtEnd(page);

  // A reload comes back here, still online and assigned (P29.5).
  await page.reload();
  await expect(
    page.getByRole('heading', { level: 1, name: `Pick up order ${courier.order}` }),
  ).toBeVisible();
  await expect(page.getByRole('banner').getByText('Online', { exact: true })).toBeVisible();

  // The board's line names the courier (A34.1); the customer sees who's coming (F7 S2).
  await expect(
    card(support.page, courier.order)
      .getByText(new RegExp(`^${courier.short} · `))
      .first(),
  ).toBeVisible({ timeout: 20_000 });
  const href = await card(support.page, courier.order).locator('h3 a').getAttribute('href');
  const customer = await browser.newContext({
    viewport: page.viewportSize() ?? undefined,
    baseURL,
  });
  const priya = await customer.newPage();
  await signIn(priya, ACCOUNTS.second, SAMPLE_PASSWORD);
  await open(priya, `/orders/${href?.split('/').at(-1) ?? ''}`);
  await expect(
    priya.getByText(`It's packed. ${courier.first} is on the way to pick it up.`),
  ).toBeVisible();
  const block = priya.getByRole('region', { name: 'Your courier' });
  await expect(block.getByText(courier.first, { exact: true })).toBeVisible();
  await expect(priya.getByText(`${courier.first} is on the way to the kitchen`)).toBeVisible();
  await expectNoAxeViolations(priya);

  // Support takes the order off (A38): the phone says so, never naming who (P31).
  await card(support.page, courier.order)
    .getByRole('button', { name: new RegExp(`actions for order ${courier.order}`, 'i') })
    .click();
  await support.page.getByRole('menuitem', { name: 'Take off courier' }).click();
  const takeOff = support.page.getByRole('dialog', {
    name: `Take order ${courier.order} off ${courier.short}?`,
  });
  await takeOff.getByRole('button', { name: 'Take off courier' }).click();
  await expect(takeOff.getByText('Choose a reason.')).toBeVisible();
  await takeOff.getByLabel('Courier asked to give it back').check();
  await takeOff.getByRole('button', { name: 'Take off courier' }).click();
  await expect(takeOff).toHaveCount(0);

  // Scoped to the page: the live region reads the same words once.
  await expect(
    page
      .getByRole('main')
      .getByText(
        `Foodz support took order ${courier.order} off you. You don't need to pick it up.`,
      ),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Waiting for orders' })).toBeVisible();
  // The customer's page goes back to finding a courier at once (S4.1), not at its next refresh.
  await expect(block).toHaveCount(0, { timeout: 4_000 });
  // Finding again, or the slow line when nobody else can be asked: then the restarted search
  // escalates at once (W5) and S3.1 applies, which depends on the other projects' couriers.
  await expect(
    priya
      .getByRole('main')
      .getByText(
        /^It's packed(\. We're finding a courier to bring it to you\.|, but finding a courier is taking longer than usual\.)/,
      ),
  ).toBeVisible();

  await page.getByRole('main').getByRole('button', { name: 'Dismiss' }).first().click();
  await page.getByRole('button', { name: 'Go offline' }).click();
  await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible();
  await customer.close();
  await support.context.close();
});

test('Riley tries practice offers', async ({ page }, testInfo) => {
  test.skip(projectOf(testInfo) !== 'partner-360', 'The demo partner is shared by everyone.');
  await signInTo(page, PARTNERS.riley);
  await open(page, '/partner');
  const online = page.getByRole('button', { name: /^Go online/ });
  if (await online.isVisible()) await online.click();
  await expect(page.getByRole('heading', { name: 'Waiting for orders' })).toBeVisible({
    timeout: 15_000,
  });

  // A practice offer arrives on this phone only (P34), with the real controls.
  await page.getByRole('button', { name: 'Send a practice offer' }).click();
  const offer = page.getByRole('dialog', { name: 'Practice offer' });
  await expect(offer).toBeVisible();
  await expect(offer.getByText("It isn't a real order.")).toBeVisible();
  await expect(offer.getByText("You'd earn", { exact: true })).toBeVisible();
  await expect(offer.getByText('$5.64', { exact: true })).toBeVisible();
  await expect(offer.getByText('Paid by card', { exact: true })).toBeVisible();
  await expectNoAxeViolations(page);
  // A tap arms the slider for 3 s only; after that a tap arms it again, and a second accepts.
  const slider = offer.getByRole('button', { name: /Accept practice offer/ });
  await slider.click();
  await expect(offer.getByText('Tap again to accept', { exact: true })).toBeVisible();
  await page.waitForTimeout(3_500);
  await expect(offer.getByText('Slide to accept', { exact: true })).toBeVisible();
  await slider.click();
  await expect(offer.getByText('Tap again to accept', { exact: true })).toBeVisible();
  await page.waitForTimeout(400);
  await slider.click();
  await expect(
    offer.getByRole('heading', {
      name: "Practice offer accepted. On a real order you'd now head to Foodz Kitchen to pick it up.",
    }),
  ).toBeVisible();
  await offer.getByRole('button', { name: 'Back to waiting' }).click();
  await expect(offer).toHaveCount(0);

  // Declining needs no reason and leaves him waiting (P23).
  await page.getByRole('button', { name: 'Send a practice offer' }).click();
  await expect(page.getByRole('dialog', { name: 'Practice offer' })).toBeVisible();
  await page.getByRole('button', { name: 'Decline order' }).click();
  await expect(page.getByRole('dialog', { name: 'Practice offer' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Waiting for orders' })).toBeVisible();

  // Profile's offer alerts (P19.3).
  await page.getByRole('link', { name: 'Profile' }).last().click();
  await page.getByRole('button', { name: 'Test offer alert' }).click();
  await expect(
    page.getByText("Didn't hear it? Turn up the volume. On iPhone, also check the silent switch."),
  ).toBeVisible();
  await expectNoAxeViolationsAtEnd(page);
});
