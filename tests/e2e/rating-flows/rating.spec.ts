import { execSync } from 'node:child_process';
import type { Page, TestInfo } from '@playwright/test';
import { Client } from 'pg';
import { ACCOUNTS, DEMO_PASSWORD, signIn } from '../account/support';
import { expect, expectNoAxeViolations, open, SAMPLE_PASSWORD, test } from '../admin/support';

/*
 * Rating a delivered order (F9 S1 to S6, design 2): from "Rate" on the Orders list to the card
 * on the order page, an empty send, stars, tags and a comment, the summary, an edit, and
 * "Rated" on the list; then the demo customer's card without comments, skipped and reopened.
 * The board's S1107 (Priya, ready) and S1106 (Dana, ready) are reset by `seed:board` and
 * delivered by hand in the test database, as the store's own driver would, so the cards are
 * food only. It runs after every other admin project (playwright.config.ts), at 1440 and at
 * 375 × 667, where the card's heading and first stars must fit above the fold.
 */

test.describe.configure({ mode: 'serial' });

const isPhone = (testInfo: TestInfo) => testInfo.project.name === 'rating-flows-375';

/** Marks a ready board fixture delivered, as "Picked up by our own driver" then "Delivered". */
async function deliverByHand(number: string): Promise<string> {
  const client = new Client({
    connectionString: process.env.DATABASE_MIGRATOR_URL ?? process.env.DATABASE_URL,
  });
  await client.connect();
  try {
    const result = await client.query<{ id: string }>(
      `UPDATE orders
          SET status = 'DELIVERED',
              picked_up_at = now() - interval '20 minutes',
              delivered_at = now() - interval '5 minutes'
        WHERE number = $1 AND status = 'READY'
        RETURNING id::text AS id`,
      [number],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error(`${number} isn't ready: run seed:board first.`);
    return id;
  } finally {
    await client.end();
  }
}

let priyaOrder = '';
let danaOrder = '';

test.beforeAll(async () => {
  execSync('npm run seed:board', { stdio: 'ignore', env: process.env, timeout: 120_000 });
  priyaOrder = await deliverByHand('S1107');
  danaOrder = await deliverByHand('S1106');
});

const orderRow = (page: Page, number: string) =>
  page
    .locator('[data-order-row]')
    .filter({ has: page.getByRole('link', { name: `Order ${number}`, exact: true }) });

const card = (page: Page) => page.locator('section#rate');

test('Priya rates her order from the list, sees her summary, edits it and finds it rated', async ({
  page,
}, testInfo) => {
  test.skip(!SAMPLE_PASSWORD, 'Needs the sample password (E2E_SEED_OUTPUT).');
  await signIn(page, ACCOUNTS.second, SAMPLE_PASSWORD);

  // S1.1: on a 375 × 667 phone the heading and the first dish's stars are above the fold.
  await open(page, `/orders/${priyaOrder}`);
  const heading = page.getByRole('heading', { name: 'How was order S1107?' });
  await expect(heading).toBeVisible();
  if (isPhone(testInfo)) {
    const stars = card(page)
      .getByRole('group', { name: /^Rate / })
      .first();
    const box = await stars.boundingBox();
    expect((box?.y ?? 9999) + (box?.height ?? 0)).toBeLessThanOrEqual(667);
  }

  // S6.1: "Rate" on her Orders list opens the card with its heading focused.
  await open(page, '/account/orders');
  const row = orderRow(page, 'S1107');
  await expect(row.getByRole('link', { name: 'Rate order S1107' })).toBeVisible();
  await expectNoAxeViolations(page);
  await row.getByRole('link', { name: 'Rate order S1107' }).click();
  await expect(page).toHaveURL(new RegExp(`/orders/${priyaOrder}#rate$`));
  await expect(heading).toBeFocused({ timeout: 15_000 });

  // S1.3: nothing picked.
  await card(page).getByRole('button', { name: 'Send ratings' }).click();
  await expect(card(page).getByText('Pick at least one star rating first.')).toBeVisible();
  await expect(card(page).getByRole('radio').first()).toBeFocused();

  // S1.2, S2.1, S2.2: stars with their word, tags for the band, a private comment.
  const dish = card(page)
    .getByRole('group', { name: /^Rate / })
    .first();
  await dish.getByRole('radio', { name: '2 stars, Poor' }).check();
  await expect(card(page).getByText('What could be better?')).toBeVisible();
  await card(page).getByRole('button', { name: 'Cold' }).click();
  await expect(card(page).getByRole('button', { name: 'Cold' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // Crossing the 3 | 4 line swaps the set and clears the presses.
  await dish.getByRole('radio', { name: '5 stars, Great' }).check();
  await expect(card(page).getByText('What was good?')).toBeVisible();
  await expect(card(page).getByRole('button', { name: 'Cold' })).toHaveCount(0);
  await card(page).getByRole('button', { name: 'Tasty' }).click();
  await card(page)
    .getByRole('button', { name: /^Add a comment about / })
    .first()
    .click();
  const comment = card(page).getByRole('textbox', { name: /^Comment about .* \(optional\)$/ });
  await expect(comment).toBeFocused();
  await comment.fill('Crispy edges <b>and</b> plenty of lettuce.\nThanks!');
  await expect(
    card(page).getByText(
      "Your stars count toward each dish's rating on the menu. Comments go to the Foodz team and aren't published.",
    ),
  ).toBeVisible();
  await expectNoAxeViolations(page);

  // S1.4: the summary, focused, with the thanks line once.
  await card(page).getByRole('button', { name: 'Send ratings' }).click();
  const summary = page.getByRole('heading', { name: 'Your ratings' });
  await expect(summary).toBeFocused({ timeout: 15_000 });
  await expect(
    page.getByText('Thanks, Priya. Every rating helps the kitchen.', { exact: true }),
  ).toBeVisible();
  const list = page.getByRole('list', { name: 'Your ratings for order S1107' });
  await expect(list.getByText('5 stars, Great')).toBeAttached();
  await expect(page.getByText(/^You can change these until /)).toBeVisible();
  await expectNoAxeViolations(page);

  // S5.1: edit, keeping her comment as typed, and save.
  await page.getByRole('button', { name: 'Edit ratings' }).click();
  await expect(heading).toBeFocused();
  await expect(card(page).getByRole('button', { name: 'Skip' })).toHaveCount(0);
  await expect(
    card(page).getByRole('textbox', { name: /^Comment about .* \(optional\)$/ }),
  ).toHaveValue('Crispy edges <b>and</b> plenty of lettuce.\nThanks!');
  await card(page)
    .getByRole('group', { name: /^Rate / })
    .first()
    .getByRole('radio', { name: '4 stars, Good' })
    .check();
  await card(page).getByRole('button', { name: 'Save changes' }).click();
  await expect(summary).toBeFocused({ timeout: 15_000 });
  await expect(list.getByText('4 stars, Good')).toBeAttached();

  // S1.5: the same state after a reload; the thanks line was a moment, not a state.
  await open(page, `/orders/${priyaOrder}`);
  await expect(summary).toBeVisible();
  await expect(page.getByText(/^Thanks, Priya/)).toHaveCount(0);

  // S6.1: "Rated" joins the row's date line; "Rate" is gone.
  await open(page, '/account/orders');
  await expect(
    orderRow(page, 'S1107')
      .getByText(/· Rated/)
      .first(),
  ).toBeVisible();
  await expect(orderRow(page, 'S1107').getByRole('link', { name: 'Rate order S1107' })).toHaveCount(
    0,
  );
});

test('the demo customer rates without comments, skips, and can still rate later', async ({
  page,
}) => {
  test.skip(!DEMO_PASSWORD, 'Needs DEMO_PASSWORD.');
  await signIn(page, ACCOUNTS.demo, DEMO_PASSWORD);
  await open(page, `/orders/${danaOrder}`);
  const heading = page.getByRole('heading', { name: 'How was order S1106?' });
  await expect(heading).toBeVisible();

  // S7.7: one line instead of comment boxes.
  await expect(card(page).getByText('Comments are turned off in the demo.')).toBeVisible();
  await expect(card(page).getByRole('button', { name: /^Add a comment/ })).toHaveCount(0);
  await expectNoAxeViolations(page);

  // S3.1: Skip acts at once; "Rate this order" takes focus.
  await card(page).getByRole('button', { name: 'Skip' }).click();
  const again = page.getByRole('button', { name: 'Rate this order' });
  await expect(again).toBeFocused({ timeout: 15_000 });

  // Skipped orders don't offer "Rate" on the list (S6.1).
  await open(page, '/account/orders');
  await expect(orderRow(page, 'S1106').getByRole('link', { name: 'Rate order S1106' })).toHaveCount(
    0,
  );

  // S3.2: within the window the card opens again, and a rating goes through.
  await open(page, `/orders/${danaOrder}`);
  await page.getByRole('button', { name: 'Rate this order' }).click();
  await expect(heading).toBeFocused();
  await card(page)
    .getByRole('group', { name: /^Rate / })
    .first()
    .getByRole('radio', { name: '4 stars, Good' })
    .check();
  await card(page).getByRole('button', { name: 'Send ratings' }).click();
  await expect(page.getByRole('heading', { name: 'Your ratings' })).toBeFocused({
    timeout: 15_000,
  });
});
