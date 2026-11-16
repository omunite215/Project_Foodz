import { describe, expect, it } from 'vitest';
import { Cuisine } from '@/server/db/enums';
import {
  canonicalDishSlug,
  CUISINES,
  dishHref,
  LEGACY_MENU_REDIRECTS,
  legacyMenuPath,
  legacyMenuRedirects,
  menuTabHref,
  parseCuisineParam,
} from './urls';

describe('cuisine tabs', () => {
  it('lists every cuisine of the database enum, in tab order', () => {
    expect(CUISINES).toEqual(['KOREAN', 'THAI', 'VIETNAMESE']);
    expect([...CUISINES].toSorted()).toEqual(Object.values(Cuisine).toSorted());
  });

  it('links each tab with a lowercase ?cuisine= value', () => {
    expect(menuTabHref('KOREAN')).toBe('/menu?cuisine=korean');
    expect(menuTabHref('THAI')).toBe('/menu?cuisine=thai');
    expect(menuTabHref('VIETNAMESE')).toBe('/menu?cuisine=vietnamese');
  });

  it.each([
    ['thai', 'THAI'],
    ['vietnamese', 'VIETNAMESE'],
    ['  Thai ', 'THAI'],
    [['thai', 'korean'], 'THAI'],
  ] as const)('reads %j as %s', (value, cuisine) => {
    expect(parseCuisineParam(value)).toBe(cuisine);
  });

  it.each([undefined, null, '', 'pizza', 'KOREAN-', [], 'thai;drop'])(
    'falls back to the Korean tab for %j',
    (value) => {
      expect(parseCuisineParam(value as string | undefined)).toBe('KOREAN');
    },
  );
});

describe('dish slugs', () => {
  it('builds dish links', () => {
    expect(dishHref('banh-khot')).toBe('/menu/banh-khot');
  });

  it.each([
    ['bulgogi', 'bulgogi'],
    ['BULGOGI', 'bulgogi'],
    [' Pad-Thai ', 'pad-thai'],
  ])('canonicalizes %j to %j', (raw, slug) => {
    expect(canonicalDishSlug(raw)).toBe(slug);
  });

  it.each([
    '',
    'x'.repeat(101),
    '\u0000',
    '%00',
    'pad thai',
    'pad--thai',
    '-pad',
    '../menu',
    'bánh',
  ])('rejects %j', (raw) => {
    expect(canonicalDishSlug(raw)).toBeNull();
  });
});

describe('old dish addresses', () => {
  it('covers all 18 dishes of the first version, each once', () => {
    const from = LEGACY_MENU_REDIRECTS.map((entry) => entry.from);
    expect(new Set(from).size).toBe(18);
    for (const path of from)
      expect(path).toMatch(/^\/menu\/(korean|thai|vietnamese)\/(km|tm|vm)0[1-6]$/);
  });

  it('points every old address at a dish page or a cuisine tab, never at another old address', () => {
    const old = new Set(LEGACY_MENU_REDIRECTS.map((entry) => entry.from));
    for (const { to } of LEGACY_MENU_REDIRECTS) {
      expect(to).toMatch(/^\/menu(\/[a-z0-9-]+|\?cuisine=(korean|thai|vietnamese))$/);
      expect(old.has(to)).toBe(false);
    }
  });

  it.each([
    ['korean', 'km01', '/menu/jajangmyeon'],
    ['korean', 'km06', '/menu/beef-noodle-soup'],
    ['vietnamese', 'vm01', '/menu/banh-khot'],
    ['vietnamese', 'vm02', '/menu?cuisine=vietnamese'],
    ['thai', 'tm02', '/menu/egg-stew'],
  ])('sends /menu/%s/%s to %s', (cuisine, id, target) => {
    expect(legacyMenuPath(cuisine, id)).toBe(target);
  });

  it.each([
    ['korean', 'km99'],
    ['thai', 'km01'],
    ['pizza', 'km01'],
  ])('sends the unknown /menu/%s/%s to the menu', (cuisine, id) => {
    expect(legacyMenuPath(cuisine, id)).toBe('/menu');
  });

  it('gives next.config.ts permanent redirects first, then a temporary catch-all', () => {
    const redirects = legacyMenuRedirects();
    expect(redirects).toHaveLength(19);
    expect(redirects[0]).toEqual({
      source: '/menu/korean/km01',
      destination: '/menu/jajangmyeon',
      permanent: true,
    });
    expect(redirects.slice(0, 18).every((entry) => entry.permanent)).toBe(true);
    expect(redirects.at(-1)).toEqual({
      source: '/menu/:cuisine(korean|thai|vietnamese)/:id',
      destination: '/menu',
      permanent: false,
    });
  });
});
