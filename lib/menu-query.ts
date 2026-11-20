import type { Cuisine } from '@/server/db/enums';
import type { CuisineCounts, DishCard, MenuSearchResult } from '@/server/modules/menu/schema';
import {
  CUISINE_PARAMS,
  CUISINES,
  DEFAULT_CUISINE,
  parseCuisineParam,
} from '@/server/modules/menu/urls';
import { CUISINE_LABELS, plural } from './format';

/*
 * The menu's search and filters in the address (F3 S6.13, S6.14, design 5.11):
 * `/menu?q=noodles&min=6&max=15&cuisine=vietnamese`. The same parser runs on the server render
 * and in the browser, so a shared link shows the same dishes before any script runs. Bad values
 * are fixed quietly, never answered with an error.
 */

/** Longer searches are cut to this many characters (S6.8). */
export const SEARCH_MAX = 100;

export interface PriceBounds {
  /** Whole dollars: the cheapest dish rounded down, the dearest rounded up ($6 to $25). */
  min: number;
  max: number;
}

export interface PriceRange {
  min: number;
  max: number;
}

export interface MenuQuery {
  /** What to search for, cleaned and at most 100 characters; '' for none. */
  q: string;
  /** Whole dollars; null when at the bound (and left out of the address). */
  min: number | null;
  max: number | null;
  cuisine: Cuisine;
  /** The address names the tab, so it keeps naming it. */
  cuisineInAddress: boolean;
}

/** $6 to $25 for the seeded menu. */
export function priceBounds(dishes: readonly Pick<DishCard, 'priceCents'>[]): PriceBounds {
  if (dishes.length === 0) return { min: 0, max: 0 };
  const prices = dishes.map((dish) => dish.priceCents);
  return { min: Math.floor(Math.min(...prices) / 100), max: Math.ceil(Math.max(...prices) / 100) };
}

const INVISIBLE = /[\p{Cc}\p{Cf}]+/gu;

/** The search as it is shown and kept: control characters gone, spaces collapsed, 100 at most. */
export function cleanSearch(raw: string): string {
  const collapsed = raw.replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trimStart();
  return Array.from(collapsed).slice(0, SEARCH_MAX).join('');
}

const DOLLARS = /^\d{1,4}$/;

function dollars(raw: string | null | undefined): number | null {
  const value = raw?.trim() ?? '';
  return DOLLARS.test(value) ? Number(value) : null;
}

const clamp = (value: number, { min, max }: PriceBounds) => Math.min(max, Math.max(min, value));

/** The range to filter by: the bounds where nothing is set. */
export function rangeOf(query: Pick<MenuQuery, 'min' | 'max'>, bounds: PriceBounds): PriceRange {
  return { min: query.min ?? bounds.min, max: query.max ?? bounds.max };
}

/** Puts a range into the query: values at the bounds become null. */
export function withRange(range: PriceRange, bounds: PriceBounds): Pick<MenuQuery, 'min' | 'max'> {
  const low = clamp(Math.min(range.min, range.max), bounds);
  const high = clamp(Math.max(range.min, range.max), bounds);
  return { min: low === bounds.min ? null : low, max: high === bounds.max ? null : high };
}

type Params = URLSearchParams | Record<string, string | string[] | undefined>;

const read = (params: Params, name: string): string | null => {
  if (params instanceof URLSearchParams) return params.get(name);
  const value = params[name];
  return (Array.isArray(value) ? value[0] : value) ?? null;
};

/** Reads and fixes the address: `min=abc` and `max=-5` are ignored, `min=30&max=10` gives $10 – $25. */
export function parseMenuQuery(params: Params, bounds: PriceBounds): MenuQuery {
  const q = cleanSearch(read(params, 'q') ?? '').trim();
  const low = dollars(read(params, 'min'));
  const high = dollars(read(params, 'max'));
  const range = withRange(
    { min: clamp(low ?? bounds.min, bounds), max: clamp(high ?? bounds.max, bounds) },
    bounds,
  );
  const cuisineParam = read(params, 'cuisine');
  return {
    q,
    ...range,
    cuisine: parseCuisineParam(cuisineParam),
    cuisineInAddress: cuisineParam !== null,
  };
}

/** The address for a query, in the order q, min, max, cuisine. */
export function menuQueryHref(query: MenuQuery): `/menu${string}` {
  const params = new URLSearchParams();
  if (query.q.trim()) params.set('q', query.q.trim());
  if (query.min !== null) params.set('min', String(query.min));
  if (query.max !== null) params.set('max', String(query.max));
  if (query.cuisineInAddress || query.cuisine !== DEFAULT_CUISINE) {
    params.set('cuisine', CUISINE_PARAMS[query.cuisine]);
  }
  const search = params.toString();
  return search ? `/menu?${search}` : '/menu';
}

/** Whether the address had to be fixed to read as `query` (S6.14). */
export function needsRewrite(params: URLSearchParams, query: MenuQuery): boolean {
  const fixed = new URLSearchParams(menuQueryHref(query).split('?')[1] ?? '');
  // An unknown cuisine shows the default tab, as before F3, and stays as it was given.
  return ['q', 'min', 'max'].some((name) => {
    const given = params.get(name);
    return given !== null && fixed.get(name) !== given;
  });
}

// ------------------------------------------------------------------ results

/** Dishes for a search, in its order (name matches first, sold out last); all of them for none. */
export function searchResults(
  dishes: readonly DishCard[],
  search: Pick<MenuSearchResult, 'kind' | 'ids'> | null,
): DishCard[] {
  if (!search || search.kind === 'all') return [...dishes];
  const byId = new Map(dishes.map((dish) => [dish.id, dish]));
  return search.ids.flatMap((id) => {
    const dish = byId.get(id);
    return dish ? [dish] : [];
  });
}

export const inRange = (dish: Pick<DishCard, 'priceCents'>, range: PriceRange) =>
  dish.priceCents >= range.min * 100 && dish.priceCents <= range.max * 100;

export function countByCuisine(dishes: readonly Pick<DishCard, 'cuisine'>[]): CuisineCounts {
  const counts: CuisineCounts = { KOREAN: 0, THAI: 0, VIETNAMESE: 0 };
  for (const dish of dishes) counts[dish.cuisine] += 1;
  return counts;
}

/** The first cuisine with matches, in tab order. */
export const firstWithMatches = (counts: CuisineCounts): Cuisine | null =>
  CUISINES.find((cuisine) => counts[cuisine] > 0) ?? null;

const ECHO_MAX = 40;

/** Her words as they are echoed back: cut at 40 characters with "…". Rendered as text. */
export function echo(q: string): string {
  const chars = Array.from(q.trim());
  return chars.length > ECHO_MAX ? `${chars.slice(0, ECHO_MAX).join('')}…` : chars.join('');
}

/** ‘noodles’ on screen; announcements drop the quotes. */
const quoted = (q: string, spoken: boolean) => (spoken ? echo(q) : `‘${echo(q)}’`);

const priceWords = (range: PriceRange) => `between $${range.min} and $${range.max}`;

const dishes = (count: number) => plural(count, 'dish', 'dishes');

/**
 * "8 dishes match ‘noodles’", "4 dishes between $6 and $15", "3 dishes match ‘noodles’ between
 * $6 and $15". Null when no search and no price filter is on.
 */
export function resultsText(
  count: number,
  q: string | null,
  range: PriceRange | null,
  spoken = false,
): string | null {
  if (!q && !range) return null;
  if (q) {
    const verb = count === 1 ? 'matches' : 'match';
    const base = `${dishes(count)} ${verb} ${quoted(q, spoken)}`;
    return range ? `${base} ${priceWords(range)}` : base;
  }
  return `${dishes(count)} ${priceWords(range!)}`;
}

/** "No exact matches for ‘bulgogy’." */
export const noExactText = (q: string, spoken = false) =>
  `No exact matches for ${quoted(q, spoken)}.`;

/** "Thai, 1 matching dish" */
export const matchingTabLabel = (cuisine: Cuisine, count: number) =>
  `${CUISINE_LABELS[cuisine]}, ${count} matching ${count === 1 ? 'dish' : 'dishes'}`;

/** "No Korean dishes match curry. Showing 2 Thai dishes." */
export const autoSwitchText = (from: Cuisine, to: Cuisine, q: string | null, count: number) =>
  `No ${CUISINE_LABELS[from]} dishes match${q ? ` ${echo(q)}` : ' your filters'}. Showing ${count} ${CUISINE_LABELS[to]} ${count === 1 ? 'dish' : 'dishes'}.`;

/** "2 Thai dishes do." / "2 Thai dishes and 1 Vietnamese dish do." / "1 Vietnamese dish does." */
export function elsewhereText(counts: CuisineCounts, except: Cuisine): string {
  const parts = CUISINES.filter((cuisine) => cuisine !== except && counts[cuisine] > 0).map(
    (cuisine) =>
      `${counts[cuisine]} ${CUISINE_LABELS[cuisine]} ${counts[cuisine] === 1 ? 'dish' : 'dishes'}`,
  );
  const total = CUISINES.reduce(
    (sum, cuisine) => sum + (cuisine === except ? 0 : counts[cuisine]),
    0,
  );
  return `${parts.join(' and ')} ${total === 1 ? 'does' : 'do'}.`;
}

export interface NoMatchCopy {
  title: string;
  line: string;
  /** Offer to reset the price range. */
  resetPrice: boolean;
  /** The tab to offer, and its button's words. */
  goTo: { cuisine: Cuisine; label: string } | null;
}

/** A tab with no matches while others have some (design 5.8). */
export function noMatchCopy(
  cuisine: Cuisine,
  counts: CuisineCounts,
  q: string | null,
  range: PriceRange | null,
): NoMatchCopy {
  const name = CUISINE_LABELS[cuisine];
  const target = CUISINES.find((other) => other !== cuisine && counts[other] > 0) ?? null;
  if (q && range) {
    return {
      title: `No ${name} dishes match ${quoted(q, false)} ${priceWords(range)}.`,
      line: elsewhereText(counts, cuisine),
      resetPrice: true,
      goTo: target ? { cuisine: target, label: `Show ${CUISINE_LABELS[target]} dishes` } : null,
    };
  }
  if (q) {
    return {
      title: `No ${name} dishes match ${quoted(q, false)}.`,
      line: elsewhereText(counts, cuisine),
      resetPrice: false,
      goTo: target ? { cuisine: target, label: `Show ${CUISINE_LABELS[target]} dishes` } : null,
    };
  }
  return {
    title: `No ${name} dishes ${priceWords(range!)}`,
    line: 'Try a wider price range.',
    resetPrice: true,
    goTo: target ? { cuisine: target, label: `See ${CUISINE_LABELS[target]} dishes` } : null,
  };
}

/** "No dishes match ‘pizza’." */
export const noResultsText = (q: string, spoken = false) =>
  spoken ? `No dishes match ${echo(q)}` : `No dishes match ${quoted(q, false)}.`;
