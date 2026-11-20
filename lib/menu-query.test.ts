import { describe, expect, it } from 'vitest';
import type { DishCard } from '@/server/modules/menu/schema';
import {
  autoSwitchText,
  cleanSearch,
  countByCuisine,
  echo,
  elsewhereText,
  inRange,
  matchingTabLabel,
  menuQueryHref,
  needsRewrite,
  noMatchCopy,
  parseMenuQuery,
  priceBounds,
  rangeOf,
  resultsText,
  searchResults,
  withRange,
} from './menu-query';

const bounds = { min: 6, max: 25 };
const params = (search: string) => new URLSearchParams(search);
const fix = (search: string) =>
  needsRewrite(params(search), parseMenuQuery(params(search), bounds));

const dish = (id: string, cuisine: DishCard['cuisine'], priceCents: number) =>
  ({ id, cuisine, priceCents }) as DishCard;

describe('reading the menu address (S6.13, S6.14)', () => {
  it('finds the price bounds from the menu, rounded out', () => {
    expect(priceBounds([{ priceCents: 699 }, { priceCents: 2499 }, { priceCents: 1299 }])).toEqual(
      bounds,
    );
  });

  it('reads a full query', () => {
    expect(parseMenuQuery(params('q=noodles&max=15&cuisine=vietnamese'), bounds)).toEqual({
      q: 'noodles',
      min: null,
      max: 15,
      cuisine: 'VIETNAMESE',
      cuisineInAddress: true,
    });
  });

  it('ignores bad prices, swaps a reversed range and leaves values at the bounds out', () => {
    expect(parseMenuQuery(params('min=abc&max=-5'), bounds)).toMatchObject({
      min: null,
      max: null,
    });
    expect(parseMenuQuery(params('min=30&max=10'), bounds)).toMatchObject({ min: 10, max: null });
    expect(parseMenuQuery(params('min=6&max=25'), bounds)).toMatchObject({ min: null, max: null });
    expect(parseMenuQuery(params('min=1.5'), bounds)).toMatchObject({ min: null });
  });

  it('cleans the search: control characters out, spaces collapsed, 100 characters at most', () => {
    expect(parseMenuQuery(params('q=%00'), bounds).q).toBe('');
    expect(parseMenuQuery(params(`q=${'a'.repeat(500)}`), bounds).q).toHaveLength(100);
    expect(cleanSearch('  pad   THAI ')).toBe('pad THAI ');
    expect(parseMenuQuery({ q: ['pho', 'bun'] }, bounds).q).toBe('pho');
  });

  it('writes the address in a fixed order, the tab only when it was chosen', () => {
    expect(
      menuQueryHref(parseMenuQuery(params('cuisine=vietnamese&max=15&q=noodles'), bounds)),
    ).toBe('/menu?q=noodles&max=15&cuisine=vietnamese');
    expect(menuQueryHref(parseMenuQuery(params(''), bounds))).toBe('/menu');
    expect(
      menuQueryHref({ q: 'pho', min: null, max: null, cuisine: 'THAI', cuisineInAddress: false }),
    ).toBe('/menu?q=pho&cuisine=thai');
  });

  it('knows when the address had to be fixed', () => {
    expect(fix('q=noodles&max=15')).toBe(false);
    expect(fix('min=abc')).toBe(true);
    expect(fix('min=30&max=10')).toBe(true);
    expect(fix(`q=${'a'.repeat(101)}`)).toBe(true);
    expect(fix('cuisine=pizza')).toBe(false);
  });

  it('keeps ranges inside the bounds', () => {
    expect(withRange({ min: 15, max: 8 }, bounds)).toEqual({ min: 8, max: 15 });
    expect(withRange({ min: 0, max: 99 }, bounds)).toEqual({ min: null, max: null });
    expect(rangeOf({ min: null, max: 15 }, bounds)).toEqual({ min: 6, max: 15 });
  });
});

describe('results (S6.2, S6.6, S6.9)', () => {
  const menu = [
    dish('kimchi', 'KOREAN', 699),
    dish('bulgogi', 'KOREAN', 2299),
    dish('curry', 'THAI', 1999),
    dish('chagio', 'VIETNAMESE', 999),
  ];

  it('orders dishes as the search does, and shows all for "all"', () => {
    expect(
      searchResults(menu, { kind: 'matches', ids: ['curry', 'kimchi', 'gone'] }).map((d) => d.id),
    ).toEqual(['curry', 'kimchi']);
    expect(searchResults(menu, { kind: 'all', ids: [] })).toHaveLength(4);
    expect(searchResults(menu, null)).toHaveLength(4);
    expect(searchResults(menu, { kind: 'none', ids: [] })).toEqual([]);
  });

  it('includes the bounds of the price range', () => {
    expect(menu.filter((item) => inRange(item, { min: 6, max: 15 })).map((d) => d.id)).toEqual([
      'kimchi',
      'chagio',
    ]);
    expect(inRange(dish('x', 'THAI', 1500), { min: 6, max: 15 })).toBe(true);
    expect(countByCuisine(menu)).toEqual({ KOREAN: 2, THAI: 1, VIETNAMESE: 1 });
  });

  it('words the results row', () => {
    expect(resultsText(8, 'noodles', null)).toBe('8 dishes match ‘noodles’');
    expect(resultsText(1, 'curry', null)).toBe('1 dish matches ‘curry’');
    expect(resultsText(4, null, { min: 6, max: 15 })).toBe('4 dishes between $6 and $15');
    expect(resultsText(3, 'noodles', { min: 6, max: 15 })).toBe(
      '3 dishes match ‘noodles’ between $6 and $15',
    );
    expect(resultsText(8, 'noodles', null, true)).toBe('8 dishes match noodles');
    expect(resultsText(24, null, null)).toBeNull();
  });

  it('cuts long echoes at 40 characters', () => {
    expect(echo('x'.repeat(50))).toBe(`${'x'.repeat(40)}…`);
  });

  it('words tabs and tabs without matches (design 5.4, 5.8)', () => {
    expect(matchingTabLabel('THAI', 1)).toBe('Thai, 1 matching dish');
    expect(matchingTabLabel('KOREAN', 0)).toBe('Korean, 0 matching dishes');
    expect(autoSwitchText('KOREAN', 'THAI', 'curry', 2)).toBe(
      'No Korean dishes match curry. Showing 2 Thai dishes.',
    );
    expect(elsewhereText({ KOREAN: 0, THAI: 2, VIETNAMESE: 1 }, 'KOREAN')).toBe(
      '2 Thai dishes and 1 Vietnamese dish do.',
    );
    expect(elsewhereText({ KOREAN: 0, THAI: 0, VIETNAMESE: 1 }, 'THAI')).toBe(
      '1 Vietnamese dish does.',
    );
    expect(noMatchCopy('KOREAN', { KOREAN: 0, THAI: 2, VIETNAMESE: 0 }, 'curry', null)).toEqual({
      title: 'No Korean dishes match ‘curry’.',
      line: '2 Thai dishes do.',
      resetPrice: false,
      goTo: { cuisine: 'THAI', label: 'Show Thai dishes' },
    });
    expect(
      noMatchCopy('THAI', { KOREAN: 3, THAI: 0, VIETNAMESE: 1 }, null, { min: 6, max: 15 }),
    ).toEqual({
      title: 'No Thai dishes between $6 and $15',
      line: 'Try a wider price range.',
      resetPrice: true,
      goTo: { cuisine: 'KOREAN', label: 'See Korean dishes' },
    });
  });
});
