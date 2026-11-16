/*
 * Storefront URLs: menu tabs, dish pages and the redirects from the first version of the site.
 *
 * This file has no runtime imports so that next.config.ts can load it for `redirects()`.
 * Import it there with a relative path: './server/modules/menu/urls'.
 */
import type { Cuisine } from '@/server/db/enums';

export const MENU_PATH = '/menu';

/** The value of `?cuisine=` for each menu tab: /menu?cuisine=thai */
export const CUISINE_PARAMS = {
  KOREAN: 'korean',
  THAI: 'thai',
  VIETNAMESE: 'vietnamese',
} as const satisfies Record<Cuisine, string>;

export type CuisineParam = (typeof CUISINE_PARAMS)[Cuisine];

/** The tab shown when the address names no cuisine, or one the menu does not have. */
export const DEFAULT_CUISINE: Cuisine = 'KOREAN';

/** In display order. */
export const CUISINES: readonly Cuisine[] = ['KOREAN', 'THAI', 'VIETNAMESE'];

export function menuTabHref(cuisine: Cuisine): `/menu?cuisine=${CuisineParam}` {
  return `/menu?cuisine=${CUISINE_PARAMS[cuisine]}`;
}

/** Reads `?cuisine=` from the address. Missing or unknown values give the default tab. */
export function parseCuisineParam(value: string | readonly string[] | null | undefined): Cuisine {
  const raw = Array.isArray(value) ? value[0] : value;
  const wanted = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return CUISINES.find((cuisine) => CUISINE_PARAMS[cuisine] === wanted) ?? DEFAULT_CUISINE;
}

export const DISH_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const DISH_SLUG_MAX_LENGTH = 100;

export function dishHref(slug: string): `/menu/${string}` {
  return `/menu/${slug}`;
}

/**
 * The canonical form of a dish slug taken from the address, or null when it cannot be one.
 * "BULGOGI" gives "bulgogi" (redirect there when it differs from what was asked for);
 * a 300-character value or one with control characters gives null (answer 404).
 */
export function canonicalDishSlug(raw: string): string | null {
  const slug = raw.trim().toLowerCase();
  return slug.length <= DISH_SLUG_MAX_LENGTH && DISH_SLUG_PATTERN.test(slug) ? slug : null;
}

/**
 * Dish pages of the first version of the site (/menu/<cuisine>/<id>) and where they are now.
 * Ceviche, Croquetas and Nasi Lemak were listed as Vietnamese by mistake and are no longer on
 * the menu, so their old pages open the Vietnamese tab.
 */
export const LEGACY_MENU_REDIRECTS: readonly { from: string; to: string }[] = [
  { from: '/menu/korean/km01', to: '/menu/jajangmyeon' },
  { from: '/menu/korean/km02', to: '/menu/gimbap' },
  { from: '/menu/korean/km03', to: '/menu/kimchi' },
  { from: '/menu/korean/km04', to: '/menu/kimchi-jjigae' },
  { from: '/menu/korean/km05', to: '/menu/yangnyeom-chicken' },
  { from: '/menu/korean/km06', to: '/menu/beef-noodle-soup' },
  { from: '/menu/vietnamese/vm01', to: '/menu/banh-khot' },
  { from: '/menu/vietnamese/vm02', to: '/menu?cuisine=vietnamese' },
  { from: '/menu/vietnamese/vm03', to: '/menu?cuisine=vietnamese' },
  { from: '/menu/vietnamese/vm04', to: '/menu/hotpot' },
  { from: '/menu/vietnamese/vm05', to: '/menu?cuisine=vietnamese' },
  { from: '/menu/vietnamese/vm06', to: '/menu/simple-noodles' },
  { from: '/menu/thai/tm01', to: '/menu/basil-pork-and-fried-eggs' },
  { from: '/menu/thai/tm02', to: '/menu/egg-stew' },
  { from: '/menu/thai/tm03', to: '/menu/fried-thai-rice' },
  { from: '/menu/thai/tm04', to: '/menu/green-curry' },
  { from: '/menu/thai/tm05', to: '/menu/pad-thai' },
  { from: '/menu/thai/tm06', to: '/menu/panang-pork-with-rice' },
];

const legacyTargets = new Map(LEGACY_MENU_REDIRECTS.map(({ from, to }) => [from, to]));

/** Where an old dish address points now. Ids that never existed go to the menu. */
export function legacyMenuPath(cuisine: string, id: string): string {
  return legacyTargets.get(`/menu/${cuisine}/${id}`) ?? MENU_PATH;
}

/**
 * Entries for `redirects()` in next.config.ts. Known old pages move permanently (308); any
 * other old-style address goes to the menu with a temporary redirect (307), so browsers do
 * not remember it. Next keeps the query string on both.
 */
export function legacyMenuRedirects() {
  return [
    ...LEGACY_MENU_REDIRECTS.map(({ from, to }) => ({
      source: from,
      destination: to,
      permanent: true,
    })),
    {
      source: '/menu/:cuisine(korean|thai|vietnamese)/:id',
      destination: MENU_PATH,
      permanent: false,
    },
  ];
}
