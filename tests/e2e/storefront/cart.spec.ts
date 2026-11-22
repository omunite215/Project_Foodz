import { expect, type Locator, type Page, test } from '@playwright/test';
import { ACCOUNTS, DEMO_PASSWORD, signIn } from '../account/support';
import {
  addDish,
  cartButton,
  cartDialog,
  expectAccessible,
  expectNoSidewaysScroll,
  isPhone,
  liveRegion,
  open,
  openCart,
  priceValue,
  savedCart,
  totalRow,
} from './support';

/** Cart A from the stories: 2 × Gimbap and 1 × Pad Thai, $47.97 of food. */
async function fillCartA(page: Page) {
  await addDish(page, 'gimbap');
  await addDish(page, 'pad-thai');
  const dialog = await openCart(page);
  await dialog.getByRole('button', { name: 'Increase Gimbap' }).click();
  await expect(priceValue(dialog, 'Subtotal')).toHaveText('$47.97');
  return dialog;
}

/**
 * The store's hours decide whether checkout can start (S3.5): while it is closed the button
 * reads "Ordering opens at …" and stays blocked. Call once the cart has its first total.
 */
async function storeClosed(dialog: Locator) {
  return (await dialog.getByText(/^We're closed right now\./).count()) > 0;
}

/** On phones the promo field sits behind "Add a promo code" (design 2.10). */
async function promoField(dialog: Locator) {
  const disclosure = dialog.getByRole('button', {
    name: /^(Add a promo code|Use a different code)$/,
  });
  if (
    (await disclosure.count()) > 0 &&
    (await disclosure.getAttribute('aria-expanded')) !== 'true'
  ) {
    await disclosure.click();
  }
  return dialog.getByRole('textbox', { name: 'Promo code' });
}

test.describe('Cart', () => {
  // Each test adds dishes through their pages and waits for real quotes.
  test.describe.configure({ timeout: 90_000 });

  test('the header bag opens the cart; Escape and Back close it, focus returns (S1.1, S1.3, S7.1)', async ({
    page,
  }, testInfo) => {
    await open(page, '/menu');
    const bag = cartButton(page);
    await expect(bag).toHaveAccessibleName('Cart, empty');
    await expect(bag).toHaveAttribute('aria-haspopup', 'dialog');
    const size = await bag.boundingBox();
    expect(size?.width).toBeGreaterThanOrEqual(44);
    expect(size?.height).toBeGreaterThanOrEqual(44);

    await bag.click();
    const dialog = cartDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { level: 2, name: 'Your cart' })).toBeFocused();
    await expect(dialog.getByRole('heading', { name: 'Your cart is empty' })).toBeVisible();
    // Full screen on phones, a 440 px panel from 768 px (D1).
    const box = await dialog.boundingBox();
    expect(box?.width).toBe(isPhone(testInfo) ? 375 : 440);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(bag).toBeFocused();
    await expect(page).toHaveURL(/\/menu$/);

    // The phone's Back closes the cart and leaves her on the page.
    await bag.click();
    await expect(dialog).toBeVisible();
    await page.goBack();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/menu$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Our menu' })).toBeVisible();
  });

  test('lines show what she picked; the stepper, remove and undo work (S1.5, S1.6, S1.8, S7.2)', async ({
    page,
  }) => {
    await addDish(page, 'gimbap');
    await addDish(page, 'pad-thai');
    await expect(cartButton(page)).toHaveAccessibleName('Cart, 2 items');
    const dialog = await openCart(page);

    const lines = dialog.getByRole('list', { name: /dish(es)? in your cart$/ });
    await expect(lines).toHaveAccessibleName('2 dishes in your cart');
    await expect(lines.getByRole('listitem')).toHaveCount(2);
    // Lines keep the order they were added in.
    await expect(lines.getByRole('link')).toHaveText(['Gimbap', 'Pad Thai']);
    await expect(lines.getByRole('link', { name: 'Gimbap' })).toHaveAttribute(
      'href',
      '/menu/gimbap',
    );

    const quantity = dialog.getByRole('group', { name: 'Quantity, Gimbap' });
    await expect(quantity.getByText('Gimbap, quantity 1')).toBeAttached();
    // At 1, the minus removes the line and says so.
    await expect(quantity.getByRole('button', { name: 'Remove Gimbap' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Increase Gimbap' }).click();
    await expect(quantity.getByText('Gimbap, quantity 2')).toBeAttached();
    await expect(dialog.getByText('2 × $12.99')).toBeVisible();
    await expect(lines).toHaveAccessibleName('3 dishes in your cart');

    // Quick taps: the count follows every tap and the total settles on the last one.
    const increase = dialog.getByRole('button', { name: 'Increase Pad Thai' });
    for (let tap = 0; tap < 4; tap += 1) await increase.click();
    await expect(dialog.getByText('Pad Thai, quantity 5')).toBeAttached();
    await expect(priceValue(dialog, 'Subtotal')).toHaveText('$135.93');
    for (const target of await dialog.getByRole('group').getByRole('button').all()) {
      const box = await target.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }

    // Remove is instant, with an undo in its place that takes the focus.
    await dialog
      .getByRole('button', { name: /^Remove Pad Thai/ })
      .last()
      .click();
    await expect(dialog.getByText('Pad Thai removed.')).toBeVisible();
    const undo = dialog.getByRole('button', { name: 'Undo removing Pad Thai' });
    await expect(undo).toBeFocused();
    await expect(liveRegion(page)).toHaveText('Pad Thai removed.');
    await undo.click();
    await expect(liveRegion(page)).toHaveText('Pad Thai is back in your cart.');
    await expect(dialog.getByText('Pad Thai, quantity 5')).toBeAttached();
    await expect(lines.getByRole('link')).toHaveText(['Gimbap', 'Pad Thai']);
    await expect(dialog.getByRole('button', { name: /^Remove Pad Thai/ }).last()).toBeFocused();
  });

  test('a guest sees the worked quote Q1 and is asked to sign in to check out (S2.1, S2.7, S1.17)', async ({
    page,
  }) => {
    const dialog = await fillCartA(page);
    await expect(priceValue(dialog, 'Subtotal')).toHaveText('$47.97');
    await expect(priceValue(dialog, /^Delivery/)).toContainText('$1.99 to $5.99');
    await expect(dialog.getByText('depending on distance')).toBeVisible();
    await expect(priceValue(dialog, 'Tax (7%)')).toHaveText('$3.36');
    await expect(totalRow(dialog)).toContainText('Total before delivery');
    await expect(totalRow(dialog)).toContainText('$51.33');
    await expect(
      dialog.getByText('You can add a tip at checkout. All of it goes to your courier.'),
    ).toBeVisible();

    if (await storeClosed(dialog)) {
      // Closed: the button says when ordering opens, and stays blocked (S3.5).
      const blocked = dialog.getByRole('button', { name: /^Ordering opens at / });
      await expect(blocked).toHaveAttribute('aria-disabled', 'true');
      // A press on the blocked button is ignored (and repeats its reason aloud).
      await blocked.click({ force: true });
      await expect(cartDialog(page)).toBeVisible();
    } else {
      // No amount on the button until the total is final (D11).
      const checkout = dialog.getByRole('button', { name: 'Go to checkout', exact: true });
      await expect(checkout).toBeVisible();
      await checkout.click();
      await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2Fcheckout&reason=checkout$/);
    }
    // The sign-in page says why, whatever the hour.
    await open(page, '/sign-in?callbackUrl=%2Fcheckout&reason=checkout');
    await expect(page.getByText('Sign in to check out. Your cart is saved.')).toBeVisible();
    expect(await savedCart(page)).toHaveLength(2);
  });

  test('Dana sees Q2, then KBBQ5 (Q4), and the compare card picks FREEDELIVERY (Q5) (S2.6, S4.4, S4.7)', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    test.skip(!DEMO_PASSWORD, 'Needs the demo password from .env.');
    await signIn(page, ACCOUNTS.demo, DEMO_PASSWORD);
    const dialog = await fillCartA(page);

    // Q2: her default address, 4.3 km away.
    await expect(priceValue(dialog, 'Delivery to Home · 4.3 km')).toHaveText('$4.14');
    await expect(priceValue(dialog, 'Tax (7%)')).toHaveText('$3.36');
    await expect(totalRow(dialog)).toContainText('$55.47');
    await expect(
      dialog.getByRole('button', {
        name: (await storeClosed(dialog)) ? /^Ordering opens at / : 'Go to checkout · $55.47',
      }),
    ).toBeVisible();
    await expect(dialog.getByText('12 Peterborough Street')).toBeVisible();

    // Q4: KBBQ5, typed in lower case with a space.
    const field = await promoField(dialog);
    await field.fill(' kbbq5 ');
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(dialog.getByText('KBBQ5 applied. You save $5.00.')).toBeVisible();
    await expect(field).toBeFocused();
    await expect(field).toHaveValue('');
    await expect(priceValue(dialog, 'Promo · KBBQ5')).toContainText('−$5.00');
    await expect(totalRow(dialog)).toContainText('$50.12');
    await expect(dialog.getByRole('button', { name: 'Remove KBBQ5' })).toBeVisible();

    // A second code that works asks first, with both real totals.
    await field.fill('FREEDELIVERY');
    await field.press('Enter');
    const compare = dialog.getByRole('region', { name: 'One promo code per order' });
    await expect(compare).toContainText(
      "Use FREEDELIVERY instead of KBBQ5? With KBBQ5 your total is $50.12. With FREEDELIVERY it's $51.33.",
    );
    await compare.getByRole('button', { name: 'Use FREEDELIVERY' }).click();
    await expect(liveRegion(page)).toHaveText('FREEDELIVERY applied. KBBQ5 removed.');
    await expect(compare).toBeHidden();
    await expect(totalRow(dialog)).toContainText('$51.33');
    const delivery = priceValue(dialog, 'Delivery to Home · 4.3 km');
    await expect(delivery).toContainText('Free');
    await expect(delivery).toContainText('$4.14');
    await expect(dialog.getByRole('button', { name: 'Remove FREEDELIVERY' })).toBeVisible();
  });

  test('a code we do not know is refused in words, and the total stays as it was (S4.5, S7.5)', async ({
    page,
  }) => {
    await addDish(page, 'kimchi');
    const dialog = await openCart(page);
    await expect(totalRow(dialog)).toContainText('$7.48');
    const field = await promoField(dialog);
    await field.fill('nope');
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(
      dialog.getByText("We couldn't find the code NOPE. Check the spelling, or try another code."),
    ).toBeVisible();
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(field).toHaveValue('nope');
    await expect(totalRow(dialog)).toContainText('$7.48');
    await expect(dialog.getByText('invalid', { exact: false })).toHaveCount(0);
  });

  test('editing a line keeps its place; "Empty cart" asks first and clears everything (S1.7, S1.9, S1.10)', async ({
    page,
  }) => {
    await addDish(page, 'gimbap');
    await addDish(page, 'kimchi');
    const dialog = await openCart(page);

    const edit = dialog.getByRole('button', { name: 'Edit Gimbap' });
    await edit.click();
    await expect(edit).toHaveAttribute('aria-expanded', 'true');
    await dialog.getByLabel('Note for the kitchen').fill('No cucumber please');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(liveRegion(page)).toHaveText('Gimbap updated.');
    await expect(edit).toBeFocused();
    await expect(dialog.getByText('Note: No cucumber please')).toBeVisible();
    await expect(dialog.getByRole('list', { name: /in your cart$/ }).getByRole('link')).toHaveText([
      'Gimbap',
      'Kimchi',
    ]);
    // The edited cart's total is announced once it settles; messages that arrive together are
    // read together, so let it come before emptying the cart.
    await expect(liveRegion(page)).toHaveText(/^Total before delivery \$\d+\.\d\d$/);

    await dialog.getByRole('button', { name: 'Empty cart' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Remove all 2 items from your cart?' });
    await expect(confirm.getByRole('button', { name: 'Keep them' })).toBeFocused();
    await confirm.getByRole('button', { name: 'Remove all' }).click();
    await expect(dialog.getByRole('heading', { name: 'Your cart is empty' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Browse the menu' })).toBeFocused();
    await expect(liveRegion(page)).toHaveText('Your cart is empty.');
    await expect(cartButton(page)).toHaveAttribute('aria-label', 'Cart, empty');
    expect(await savedCart(page)).toEqual([]);
  });

  test('"View cart" on the dish page opens the cart and gets the focus back (S1.4, D3)', async ({
    page,
  }) => {
    await addDish(page, 'gimbap');
    const view = page.locator('main').getByRole('button', { name: 'View cart' });
    await view.click();
    const dialog = cartDialog(page);
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Close cart' }).click();
    await expect(dialog).toBeHidden();
    await expect(view).toBeFocused();
    await expect(page).toHaveURL(/\/menu\/gimbap$/);
  });

  test('R5 "Sign in" leaves the cart closed on the sign-in page and reopens it on return (S4.8)', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    test.skip(!DEMO_PASSWORD, 'Needs the demo password from .env.');
    await addDish(page, 'gimbap');
    await addDish(page, 'kimchi');
    const dialog = await openCart(page);
    const field = await promoField(dialog);
    await field.fill('WELCOME10');
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(
      dialog.getByText(
        "Sign in to use WELCOME10. It's one per customer, so we need to know it's you.",
      ),
    ).toBeVisible();
    await dialog.getByRole('link', { name: 'Sign in' }).click();

    await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2Fmenu%2Fkimchi&reason=promo$/);
    await expect(page.getByText('Sign in to use WELCOME10.', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(cartDialog(page)).toBeHidden();

    await page.getByLabel('Email').fill(ACCOUNTS.demo);
    await page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/menu\/kimchi$/, { timeout: 30_000 });
    // Back on the page with the cart open, and the code checked again as her: it applies, or
    // says why not (R6 once used, R7 while an order holds it).
    const back = cartDialog(page);
    await expect(back).toBeVisible();
    await expect(
      back
        .getByRole('button', { name: 'Remove WELCOME10' })
        .or(back.getByText(/^(You've already used WELCOME10|WELCOME10 is on hold)/)),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('on phones an offer\'s "Apply" shows its answer: a refusal, then the compare card (S4.7, S4.10)', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await addDish(page, 'pad-thai');
    let dialog = await openCart(page);
    await dialog
      .getByRole('region', { name: 'Offers' })
      .getByRole('button', { name: 'Apply KBBQ5' })
      .click();
    await expect(
      dialog.getByText('KBBQ5 is for Korean dishes. Add a Korean dish to use it.'),
    ).toBeVisible();

    // Two Gimbap make KBBQ5 work; FREEDELIVERY then asks which one to keep.
    await page.keyboard.press('Escape');
    await addDish(page, 'gimbap');
    dialog = await openCart(page);
    await dialog.getByRole('button', { name: 'Increase Gimbap' }).click();
    await expect(priceValue(dialog, 'Subtotal')).toHaveText('$47.97');
    const offers = dialog.getByRole('region', { name: 'Offers' });
    await offers.getByRole('button', { name: 'Apply KBBQ5' }).click();
    await expect(dialog.getByText('KBBQ5 applied. You save $5.00.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Remove KBBQ5' })).toBeVisible();
    if (isPhone(testInfo)) {
      // Folded away again, the next answer still shows.
      const disclosure = dialog.getByRole('button', { name: 'Use a different code' });
      await disclosure.click();
      await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    }
    await offers.getByRole('button', { name: 'Apply FREEDELIVERY' }).click();
    const compare = dialog.getByRole('region', { name: 'One promo code per order' });
    await expect(compare.getByRole('button', { name: 'Keep KBBQ5' })).toBeVisible();
    await expect(compare.getByRole('button', { name: 'Use FREEDELIVERY' })).toBeVisible();
  });

  test('a code crossing its minimum is announced together with the new total (S4.6, S7.3)', async ({
    page,
  }) => {
    await addDish(page, 'gimbap');
    const dialog = await openCart(page);
    const field = await promoField(dialog);
    await field.fill('KBBQ5');
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(dialog.getByText('Not applied yet')).toBeVisible();

    await dialog.getByRole('button', { name: 'Increase Gimbap' }).click();
    await expect(liveRegion(page)).toContainText('KBBQ5 applied. You save $5.00.');
    await expect(liveRegion(page)).toContainText(/Total( before delivery)? \$\d+\.\d\d/);

    await dialog.getByRole('button', { name: 'Decrease Gimbap' }).click();
    await expect(liveRegion(page)).toContainText('KBBQ5 is no longer applied.');
    await expect(liveRegion(page)).toContainText(/Total( before delivery)? \$\d+\.\d\d/);
  });

  test('checking an address moves focus with her: into the field, then to "Change" (2.15 B)', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await addDish(page, 'kimchi');
    const dialog = await openCart(page);
    const delivery = dialog.getByRole('region', { name: 'Delivery' });
    await delivery.getByRole('button', { name: 'Check your address' }).click();
    const field = delivery.getByRole('combobox', { name: 'Your address' });
    await expect(field).toBeFocused();

    await field.pressSequentially('Peterborough Street', { delay: 25 });
    const options = dialog
      .getByRole('listbox', { name: 'Address suggestions' })
      .getByRole('option');
    await expect(options.filter({ hasText: /Boston/ }).first()).toBeVisible({ timeout: 20_000 });
    const index = (await options.allInnerTexts()).findIndex((text) => /Boston/.test(text));
    for (let step = 0; step <= index; step++) await field.press('ArrowDown');
    await field.press('Enter');
    const change = delivery.getByRole('button', { name: 'Change delivery address' });
    await expect(change).toBeFocused({ timeout: 15_000 });
    await expect(priceValue(dialog, /^Delivery to your address/)).toContainText('$');

    // "Change" opens the field again with her address in it, selected.
    await change.click();
    await expect(field).toBeFocused();
    await expect(field).toHaveValue(/Peterborough Street/);
    expect(
      await field.evaluate((element) => {
        const input = element as HTMLInputElement;
        return input.selectionStart === 0 && input.selectionEnd === input.value.length;
      }),
    ).toBe(true);
  });

  test('after signing in, her saved default address beats one checked as a guest (S2.6)', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    test.skip(!DEMO_PASSWORD, 'Needs the demo password from .env.');
    await addDish(page, 'gimbap');
    // An address checked in the cart before signing in (kept in this tab only).
    await page.evaluate(() =>
      sessionStorage.setItem(
        'foodz.cart.point',
        JSON.stringify({ line1: 'Peterborough Street', lat: 42.3449, lng: -71.0986 }),
      ),
    );
    let dialog = await openCart(page);
    await expect(priceValue(dialog, /^Delivery to your address/)).toContainText('$');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await signIn(page, ACCOUNTS.demo, DEMO_PASSWORD);
    dialog = await openCart(page);
    await expect(priceValue(dialog, 'Delivery to Home · 4.3 km')).toHaveText('$4.14');
    await dialog.getByRole('button', { name: 'Change delivery address' }).click();
    await expect(
      dialog.getByRole('group', { name: 'Deliver to' }).getByRole('radio', { name: /Home/ }),
    ).toBeChecked();
    await expect(dialog.getByRole('link', { name: 'Manage addresses' })).toBeVisible();
  });

  test('fits a 320 px screen without sideways scrolling, and has no accessibility violations (S7.10)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await addDish(page, 'basil-pork-and-fried-eggs');
    await addDish(page, 'gimbap');
    const dialog = await openCart(page);
    await expect(priceValue(dialog, 'Subtotal')).toHaveText('$34.98');
    await expectNoSidewaysScroll(page);
    const overflow = await dialog.evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expectAccessible(page);
  });
});
