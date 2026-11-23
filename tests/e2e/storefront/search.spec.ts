import { expect, type Page, test } from '@playwright/test';
import { expectAccessible, expectNoSidewaysScroll, isPhone, liveRegion, open } from './support';

const searchField = (page: Page) => page.getByRole('searchbox', { name: 'Search the menu' });
const panelLinks = (page: Page) => page.getByRole('tabpanel').getByRole('link');

/** How far the green pill is from the selected tab, in px (0 when it sits right under it). */
const pillOffset = (page: Page) =>
  page.getByRole('tablist', { name: 'Cuisine' }).evaluate((list) => {
    const pill = list.querySelector('[data-tab-pill]')?.getBoundingClientRect();
    const tab = list.querySelector('[role="tab"][aria-selected="true"]')?.getBoundingClientRect();
    if (!pill || !tab) return Number.POSITIVE_INFINITY;
    return Math.max(Math.abs(pill.left - tab.left), Math.abs(pill.width - tab.width));
  });

/** Where the menu toolbar's top edge is on screen, in whole px. */
const toolbarTop = (page: Page) =>
  page
    .locator('[data-menu-toolbar]')
    .evaluate((element) => Math.round(element.getBoundingClientRect().top));

test.describe('Menu search and filters', () => {
  test('results follow her words across cuisines and stay in the address (S6.1, S6.2, S6.13)', async ({
    page,
  }) => {
    await open(page, '/menu');
    const search = page.getByRole('search', { name: 'Menu' });
    await expect(search).toBeVisible();
    const field = searchField(page);
    await expect(field).toHaveAttribute('type', 'search');
    await expect(field).toHaveAttribute('placeholder', 'Try noodles, spicy or pho');
    expect(await field.evaluate((element) => getComputedStyle(element).fontSize)).toBe(
      isPhone(test.info()) ? '16px' : '18px',
    );
    await expect(page.getByRole('button', { name: 'Clear search' })).toHaveCount(0);

    await field.fill('noodles');
    await expect(page.getByText('8 dishes match ‘noodles’')).toBeVisible();
    await expect(liveRegion(page)).toHaveText('8 dishes match noodles');
    await expect(page).toHaveURL(/\/menu\?q=noodles$/);
    // Each tab counts its own matches; together they make the 8.
    const counts = await page
      .getByRole('tab')
      .evaluateAll((tabs) =>
        tabs.map((tab) => Number(/, (\d+) matching dish/.exec(tab.textContent ?? '')?.[1] ?? NaN)),
      );
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(8);
    // Name matches first; the sold-out dish last.
    const korean = await panelLinks(page).evaluateAll((links) =>
      links.map((link) => link.querySelector('.sr-only')?.textContent ?? ''),
    );
    expect(korean.at(-1)).toMatch(/^Naengmyeon, .*Sold out today/);
    await expect(field).toBeFocused();

    // Rendered by the server on a reload, before scripts run.
    await page.reload();
    await expect(searchField(page)).toHaveValue('noodles');
    await expect(page.getByText('8 dishes match ‘noodles’')).toBeVisible();

    // Typing adds no history entries.
    await searchField(page).fill('noodle soup');
    await expect(page).toHaveURL(/q=noodle\+soup/);
    await page.goBack();
    await expect(page).not.toHaveURL(/\/menu/);
  });

  test('a tab without matches hands over to one with matches, and says so (S6.6)', async ({
    page,
  }) => {
    await open(page, '/menu');
    await searchField(page).fill('curry');
    await expect(liveRegion(page)).toHaveText(
      'No Korean dishes match curry. Showing 2 Thai dishes.',
    );
    await expect(page.getByRole('tab', { name: 'Thai, 2 matching dishes' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page).toHaveURL(/q=curry&cuisine=thai/);
    await expect(panelLinks(page)).toHaveCount(2);

    await page.getByRole('tab', { name: 'Korean, 0 matching dishes' }).click();
    await expect(
      page.getByRole('heading', { name: 'No Korean dishes match ‘curry’.' }),
    ).toBeVisible();
    await expect(page.getByText('2 Thai dishes do.')).toBeVisible();
    await page.getByRole('button', { name: 'Show Thai dishes' }).click();
    await expect(page.getByRole('tab', { name: /^Thai,/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('the green pill follows the selected tab, also after a search switches tabs (5.4)', async ({
    page,
  }) => {
    await open(page, '/menu');
    await expect.poll(() => pillOffset(page)).toBeLessThan(2);
    for (const name of [/^Thai,/, /^Vietnamese,/, /^Korean,/]) {
      await page.getByRole('tab', { name }).click();
      await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
      await expect.poll(() => pillOffset(page)).toBeLessThan(2);
    }

    // "curry" has no Korean dishes, so the search moves to Thai by itself.
    await searchField(page).fill('curry');
    await expect(page.getByRole('tab', { name: /^Thai,/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect.poll(() => pillOffset(page)).toBeLessThan(2);
    await page.getByRole('tab', { name: /^Korean,/ }).click();
    await expect.poll(() => pillOffset(page)).toBeLessThan(2);
  });

  test('on phones the first keystroke and the header search link bring the toolbar to the top (S6.16)', async ({
    page,
  }, testInfo) => {
    test.skip(!isPhone(testInfo), 'The toolbar sticks to the top below 1024 px only.');
    await open(page, '/menu');
    await searchField(page).fill('p');
    await expect.poll(() => toolbarTop(page)).toBe(0);

    await open(page, '/blog');
    await page.locator('header').getByRole('link', { name: 'Search the menu' }).click();
    await expect(searchField(page)).toBeFocused();
    await expect.poll(() => toolbarTop(page)).toBe(0);
  });

  test('nothing found shows ideas; a typo offers a close match; her words stay text (S6.5, S6.7)', async ({
    page,
  }) => {
    await open(page, '/menu');
    const field = searchField(page);
    await field.fill('<b>pizza</b>');
    await expect(
      page.getByRole('heading', { name: 'No dishes match ‘<b>pizza</b>’.' }),
    ).toBeVisible();
    await expect(page.locator('main b')).toHaveCount(0);
    await expect(
      page.getByText(
        'Check the spelling, or try a dish, an ingredient like beef, shrimp or tofu, or a cuisine.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: "Ideas from today's specials" })).toBeVisible();
    await page.getByRole('button', { name: 'Clear search', exact: true }).last().click();
    await expect(field).toHaveValue('');
    await expect(field).toBeFocused();
    await expect(page).toHaveURL(/\/menu$/);

    await field.fill('bulgogy');
    await expect(page.getByText('No exact matches for ‘bulgogy’.')).toBeVisible();
    await page.getByRole('button', { name: 'Bulgogi', exact: true }).click();
    await expect(field).toHaveValue('Bulgogi');
    await expect(page).toHaveURL(/q=Bulgogi/);
    await expect(panelLinks(page).first()).toHaveAccessibleName(/^Bulgogi,/);
  });

  test('Escape clears the field; "Clear all" keeps the tab (S6.11, S7.7)', async ({ page }) => {
    await open(page, '/menu?cuisine=vietnamese');
    const field = searchField(page);
    await field.fill('shrimp');
    await expect(page.getByText('4 dishes match ‘shrimp’')).toBeVisible();
    await page.getByRole('button', { name: 'Clear all' }).click();
    await expect(field).toHaveValue('');
    await expect(field).toBeFocused();
    await expect(page).toHaveURL(/\/menu\?cuisine=vietnamese$/);
    await expect(page.getByRole('tab', { name: 'Vietnamese, 6 dishes' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await field.fill('pho');
    await expect(page.getByText(/dish(es)? match(es)? ‘pho’/)).toBeVisible();
    await field.press('Escape');
    await expect(field).toHaveValue('');
    await expect(page.getByRole('tab', { name: 'Vietnamese, 6 dishes' })).toBeVisible();
  });

  test('the price range filters by whole dollars, from the keyboard or presets (S6.9, S6.10, S7.8)', async ({
    page,
  }, testInfo) => {
    await open(page, '/menu');
    if (isPhone(testInfo)) {
      const filters = page.getByRole('button', { name: 'Filters', exact: true });
      await filters.click();
      const sheet = page.getByRole('dialog', { name: 'Filters' });
      await expect(sheet.getByRole('slider', { name: 'Lowest price' })).toBeFocused();
      await sheet.getByRole('button', { name: 'Under $15' }).click();
      await expect(sheet.getByRole('button', { name: 'Under $15' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(sheet.getByRole('button', { name: 'Show 4 dishes' })).toBeVisible();
      await expectAccessible(page);
      await sheet.getByRole('button', { name: 'Show 4 dishes' }).click();
      await expect(sheet).toBeHidden();
      await expect(page.getByRole('button', { name: 'Filters, 1 on' })).toBeFocused();
    } else {
      const high = page.getByRole('slider', { name: 'Highest price' });
      await expect(high).toHaveAttribute('aria-valuetext', '$25');
      await high.focus();
      for (let step = 0; step < 2; step += 1) await page.keyboard.press('PageDown');
      await expect(high).toHaveAttribute('aria-valuetext', '$15');
      const low = page.getByRole('slider', { name: 'Lowest price' });
      await expect(low).toHaveAttribute('aria-valuemax', '15');
    }
    await expect(page).toHaveURL(/\/menu\?max=15$/);
    await expect(page.locator('main').getByText('4 dishes between $6 and $15')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Korean, 3 matching dishes' })).toBeVisible();

    await page.getByRole('tab', { name: 'Thai, 0 matching dishes' }).click();
    await expect(
      page.getByRole('heading', { name: 'No Thai dishes between $6 and $15' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Show all prices' }).click();
    await expect(page).toHaveURL(/\/menu\?cuisine=thai$/);
    await expect(page.getByRole('tab', { name: 'Thai, 6 dishes' })).toBeVisible();
  });

  test('a bad address is fixed quietly, never an error page (S6.14)', async ({ page }) => {
    const response = await open(page, '/menu?min=abc&max=-5');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/menu$/);

    await open(page, '/menu?min=30&max=10');
    await expect(page).toHaveURL(/\/menu\?min=10$/);
    await expect(page.locator('main').getByText(/dish(es)? between \$10 and \$25/)).toBeVisible();

    await open(page, `/menu?q=${'a'.repeat(500)}`);
    await expect(searchField(page)).toHaveValue('a'.repeat(100));
  });

  test('the header search icon opens the menu with the field focused (S6.16)', async ({ page }) => {
    await open(page, '/');
    const link = page.locator('header').getByRole('link', { name: 'Search the menu' });
    await expect(link).toHaveAttribute('href', '/menu#search');
    await link.click();
    await expect(page).toHaveURL(/\/menu#search$/);
    await expect(searchField(page)).toBeFocused();
  });

  test('has no accessibility violations with a search on, and nothing scrolls sideways', async ({
    page,
  }) => {
    await open(page, '/menu?q=noodles&max=15');
    await expect(
      page.locator('main').getByText(/match(es)? ‘noodles’ between \$6 and \$15/),
    ).toBeVisible();
    await expectAccessible(page);
    await expectNoSidewaysScroll(page);
  });
});
