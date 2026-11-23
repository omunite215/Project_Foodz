import { execSync } from 'node:child_process';
import type { Page, WebSocketRoute } from '@playwright/test';
import { signIn } from '../account/support';
import {
  ACCOUNTS,
  card,
  expect,
  open,
  SAMPLE_PASSWORD,
  signInStaff,
  STAFF,
  test,
} from '../admin/support';

/*
 * The board's timers and "86 it" on the menu (F5 A3.1, A3.3, A4.7, U24). They refuse an order,
 * leave moves in place and sell a dish out, so they run after every other admin project, one at
 * a time, and put the fixtures back before and after.
 */

test.describe.configure({ mode: 'serial' });

const resetFixtures = () =>
  execSync('npm run seed:board', { stdio: 'ignore', env: process.env, timeout: 120_000 });

test.beforeEach(resetFixtures);
test.afterAll(resetFixtures);

/** Counts the chime's notes: every chime starts two oscillators. */
async function countNotes(page: Page) {
  await page.addInitScript(() => {
    const counter = { notes: 0 };
    Object.assign(window, { chimeNotes: counter });
    // `start` lives on the shared parent of OscillatorNode; the board starts nothing else.
    const prototype = AudioScheduledSourceNode.prototype;
    const start = Object.getOwnPropertyDescriptor(prototype, 'start');
    if (!start || typeof start.value !== 'function') return;
    const original: (this: AudioScheduledSourceNode, when?: number) => void = start.value;
    Object.defineProperty(prototype, 'start', {
      ...start,
      value(this: AudioScheduledSourceNode, when?: number) {
        counter.notes += 1;
        original.call(this, when);
      },
    });
  });
  return () =>
    page.evaluate(() => (window as unknown as { chimeNotes: { notes: number } }).chimeNotes.notes);
}

/** Headless Chromium never hides a tab: the board is told it is hidden, or seen again. */
function setVisibility(page: Page, state: 'hidden' | 'visible') {
  return page.evaluate((next) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => next });
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => next === 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

test('Undo goes when the server stops taking it (A4.7, A8.1)', async ({ page }) => {
  await signInStaff(page, STAFF.kitchen, '/admin/orders');
  const pressed = Date.now();
  await card(page, 'S1103').getByRole('button', { name: 'Start cooking order S1103' }).click();
  const undo = card(page, 'S1103').getByRole('button', { name: /^Undo, move order S1103/ });
  await expect(undo).toBeVisible({ timeout: 10_000 });
  await expect(undo).toBeHidden({ timeout: 12_000 });
  // The server allows 10 s from the move (and 2 s for the round trip); never more on screen.
  expect(Date.now() - pressed).toBeLessThan(12_000);
});

test('the chime repeats every minute while an order waits in New (A3.3)', async ({ page }) => {
  const notes = await countNotes(page);
  await signInStaff(page, STAFF.kitchen, '/admin/orders');
  await page.clock.install();
  // S1102 has waited about 6 minutes in New.
  await page.getByRole('button', { name: 'Turn on sound' }).click();
  await expect(page.getByRole('button', { name: 'Sound on, turn off' })).toBeVisible();
  await expect.poll(notes).toBe(2);
  // The board draws again on its own (timers, refreshes); the repeat must still come.
  await page.clock.fastForward(61_000);
  await expect.poll(notes, { timeout: 10_000 }).toBeGreaterThanOrEqual(4);
  await page.clock.fastForward(61_000);
  await expect.poll(notes, { timeout: 10_000 }).toBeGreaterThanOrEqual(6);
});

test('the hidden-tab count stays until the tab is seen (A3.1)', async ({ page, browser }) => {
  // The realtime socket goes through here, so the test can drop it like a flaky network.
  const sockets: WebSocketRoute[] = [];
  await page.routeWebSocket(/.*/, (socket) => {
    socket.connectToServer();
    sockets.push(socket);
  });
  await signInStaff(page, STAFF.kitchen, '/admin/orders');
  await expect(page.getByText('Live', { exact: true })).toBeVisible({ timeout: 15_000 });

  // Another tablet refuses S1101, so it leaves this board.
  const other = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const tablet = await other.newPage();
  await signInStaff(tablet, STAFF.kitchen, '/admin/orders');
  await card(tablet, 'S1101').getByRole('button', { name: 'More actions for order S1101' }).click();
  await tablet.getByRole('menuitem', { name: "Can't make it" }).click();
  const dialog = tablet.getByRole('dialog', { name: "Can't make order S1101?" });
  await dialog.getByRole('radio', { name: 'Kitchen is too busy' }).check();
  await dialog.getByRole('button', { name: 'Refuse order' }).click();
  await expect(card(page, 'S1101')).toHaveCount(0, { timeout: 15_000 });
  await other.close();

  // While this tab is hidden, S1101 is back in New; catching up after the dropped connection
  // brings it in as a new order.
  await setVisibility(page, 'hidden');
  resetFixtures();
  for (const socket of sockets.splice(0)) await socket.close();
  await expect(page).toHaveTitle('(1) Order board | Foodz Admin', { timeout: 30_000 });
  // It stays while the tab is still hidden, whatever else draws the page meanwhile.
  await page.waitForTimeout(8_000);
  await expect(page).toHaveTitle('(1) Order board | Foodz Admin');
  await setVisibility(page, 'visible');
  await expect(page).toHaveTitle('Order board | Foodz Admin');
});

test('"86 it" reaches a menu that is already open (U24)', async ({ page, browser }) => {
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.clock.install();
  await open(guest, '/menu?q=kimchi');
  // Every Kimchi card on the page (the results and today's specials).
  const soldOut = guest.getByRole('link', { name: /^Kimchi, .*Sold out today/ });
  const onSale = guest.getByRole('link', { name: /^Kimchi, (?!.*Sold out today)/ });
  await expect(onSale.first()).toBeVisible();
  await expect(soldOut).toHaveCount(0);

  await signInStaff(page, STAFF.kitchen, '/admin/orders');
  await page
    .getByRole('button', { name: /^Sold out/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Mark Kimchi sold out' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Mark sold out' }).click();
  await expect(page.getByRole('button', { name: 'Put Kimchi back on the menu' })).toBeVisible();

  // "The menu updates within a minute": the open menu reads itself again every 30 s.
  await guest.clock.fastForward(31_000);
  await expect(onSale).toHaveCount(0, { timeout: 15_000 });
  await expect(soldOut.first()).toBeVisible();
  // A fresh visit shows it at once.
  await open(guest, '/menu?q=kimchi');
  await expect(soldOut.first()).toBeVisible();
  await expect(onSale).toHaveCount(0);

  await page.getByRole('button', { name: 'Put Kimchi back on the menu' }).click();
  await expect(page.getByRole('button', { name: 'Mark Kimchi sold out' })).toBeVisible();
  await guest.clock.fastForward(31_000);
  await expect(soldOut).toHaveCount(0, { timeout: 15_000 });
  await expect(onSale.first()).toBeVisible();
  await guestContext.close();
});

/** Priya's row for an order on her open orders list. */
const orderRow = (page: Page, number: string) =>
  page
    .locator('[data-order-row]')
    .filter({ has: page.getByRole('link', { name: `Order ${number}`, exact: true }) });

test('the open orders list follows the kitchen and says so (S7.2 to S7.4)', async ({
  page,
  browser,
}) => {
  test.skip(!SAMPLE_PASSWORD, 'Needs the sample password (E2E_SEED_OUTPUT).');
  await signIn(page, ACCOUNTS.second, SAMPLE_PASSWORD);
  await open(page, '/account/orders');
  await expect(orderRow(page, 'S1103').getByText('Accepted', { exact: true })).toBeVisible();
  await expect(orderRow(page, 'S1105').getByText('Cooking', { exact: true })).toBeVisible();

  const kitchenContext = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const kitchen = await kitchenContext.newPage();
  await signInStaff(kitchen, STAFF.kitchen, '/admin/orders');

  // Live: the chip changes in place and the change is read out once, politely.
  await card(kitchen, 'S1103').getByRole('button', { name: 'Start cooking order S1103' }).click();
  await expect(orderRow(page, 'S1103').getByText('Cooking', { exact: true })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator('output[aria-live="polite"]')).toHaveText('Order S1103: Cooking.');

  // Without the live connection: coming back to the tab reads the list again.
  await page.routeWebSocket(/.*/, () => {});
  await page.reload();
  await expect(orderRow(page, 'S1105').getByText('Cooking', { exact: true })).toBeVisible();
  await card(kitchen, 'S1105').getByRole('button', { name: 'Mark ready order S1105' }).click();
  await expect(card(kitchen, 'S1105').getByText('Moved just now')).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(orderRow(page, 'S1105').getByText('Ready', { exact: true })).toBeVisible({
    timeout: 10_000,
  });
  await kitchenContext.close();
});
