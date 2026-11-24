'use client';

import { useDebouncer } from '@tanstack/react-pacer';
import { Search, X } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { Cuisine } from '@/server/db/enums';
import { searchMenuAction } from '@/server/modules/menu/actions';
import type {
  CuisineCounts,
  DishCard as Dish,
  MenuSearchResult,
} from '@/server/modules/menu/schema';
import { CUISINES } from '@/server/modules/menu/urls';
import { DishCard } from '@/components/dish/dish-card';
import { useSlowPending } from '@/components/forms/submit-button';
import {
  focusMenuSearch,
  MENU_SEARCH_ID,
  scrollMenuToolbarToTop,
} from '@/components/layout/search-link';
import { EmptyState } from '@/components/states/empty-state';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Tabs } from '@/components/ui/tabs';
import { callAction } from '@/lib/action-result';
import { announce } from '@/lib/announce';
import {
  autoSwitchText,
  cleanSearch,
  countByCuisine,
  firstWithMatches,
  inRange,
  matchingTabLabel,
  type MenuQuery,
  menuQueryHref,
  needsRewrite,
  noExactText,
  noMatchCopy,
  noResultsText,
  parseMenuQuery,
  type PriceBounds,
  type PriceRange as Range,
  rangeOf,
  resultsText,
  searchResults,
  withRange,
} from '@/lib/menu-query';
import { replaceAddress } from '@/lib/dialog-history';
import { useScrollMemory } from '@/lib/scroll-memory';
import { useOnline } from '@/lib/use-online';
import { CuisinePanel, CuisineTabList, DishGrid } from './cuisine-menu';
import { FiltersSheet } from './filters-sheet';
import { PriceRange } from './price-range';
import { useFreshMenu } from './use-fresh-menu';

/*
 * The menu with search and filters (F3 S6, design 5). Every dish is already on the page; only
 * the words go to the server (B9, B10). The address holds the search, the price and the tab
 * without adding history entries, and the server renders the same results for a shared link.
 */

const SEARCH_WAIT_MS = 300;
const SEARCH_TIMEOUT_MS = 10_000;

const SEARCH_OFFLINE =
  "You're offline. Search needs a connection, but you can still browse by cuisine and price.";

interface Searched {
  q: string;
  result: MenuSearchResult;
}

/** Answers already seen in this tab, so Back to the menu shows its results at once. */
const searchCache = new Map<string, MenuSearchResult>();

type SearchState =
  | { kind: 'idle' }
  | { kind: 'searching'; q: string }
  | { kind: 'slow'; q: string }
  | { kind: 'limited'; q: string; retryAfter: number }
  | { kind: 'offline'; q: string };

/** Writes the address without a history entry or a request (B11). */
function writeAddress(query: MenuQuery) {
  const href = `${menuQueryHref(query)}${window.location.hash}`;
  if (href !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    replaceAddress(href);
  }
}

/** A link inside a sentence: the padding gives a 44 px target without adding leading. */
const linkButton =
  '-my-3 inline-block py-3 font-medium text-brand-strong underline underline-offset-4';

export function MenuBrowser({
  dishes,
  counts,
  bounds,
  initialSearch,
  specials,
}: {
  dishes: Dish[];
  counts: CuisineCounts;
  bounds: PriceBounds;
  /** The search the server ran for this address (null without `q`). */
  initialSearch: MenuSearchResult | null;
  /** Today's specials, as ideas when nothing matches. */
  specials: Dish[];
}) {
  const params = useSearchParams();
  const query = parseMenuQuery(params, bounds);
  const online = useOnline();
  const fieldRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(query.q);
  // The server's answer is for the address it rendered; after Back, the address may have moved on.
  const [searched, setSearched] = useState<Searched | null>(() => {
    const known =
      searchCache.get(query.q) ?? (initialSearch?.query === query.q ? initialSearch : null);
    return known && query.q ? { q: query.q, result: known } : null;
  });
  const answeredOnArrival = useRef(searched !== null);
  const [state, setState] = useState<SearchState>({ kind: 'idle' });
  const requestId = useRef(0);
  const typedOnce = useRef(false);

  // Back from a dish returns to the same results, place and card (S6.13).
  useScrollMemory('/menu');
  // Sold-out changes from the kitchen show up without a reload (F5 U24).
  useFreshMenu();

  const latestQuery = useRef(query);
  useEffect(() => {
    latestQuery.current = query;
  });

  async function runSearch(raw: string) {
    const q = cleanSearch(raw).trim();
    const ticket = ++requestId.current;
    if (!q) {
      setSearched(null);
      setState({ kind: 'idle' });
      writeAddress({ ...latestQuery.current, q: '' });
      return;
    }
    if (!navigator.onLine) {
      setState({ kind: 'offline', q });
      return;
    }
    setState({ kind: 'searching', q });
    const outcome = await callAction(() => searchMenuAction({ q }), {
      timeoutMs: SEARCH_TIMEOUT_MS,
    });
    if (ticket !== requestId.current) return;
    if (outcome.ok) {
      searchCache.set(q, outcome.data);
      if (searchCache.size > 50) searchCache.delete(searchCache.keys().next().value ?? '');
      setSearched({ q, result: outcome.data });
      setState({ kind: 'idle' });
      writeAddress({ ...latestQuery.current, q });
      return;
    }
    if (outcome.error.code === 'RATE_LIMITED') {
      setState({ kind: 'limited', q, retryAfter: outcome.error.retryAfterSeconds ?? 5 });
    } else if (outcome.error.code === 'OFFLINE') {
      setState({ kind: 'offline', q });
    } else {
      setState({ kind: 'slow', q });
    }
  }

  const searchLater = useDebouncer((value: string) => void runSearch(value), {
    wait: SEARCH_WAIT_MS,
  });
  const latestRun = useRef(runSearch);
  useEffect(() => {
    latestRun.current = runSearch;
  });

  // On arrival: fix a bad address quietly (S6.14), search a query the server didn't, and focus
  // the field for the header's search icon (S6.16).
  useEffect(() => {
    const current = latestQuery.current;
    const address = new URLSearchParams(window.location.search);
    if (needsRewrite(address, current)) writeAddress(current);
    if (current.q && !answeredOnArrival.current) void latestRun.current(current.q);
    if (window.location.hash === '#search') focusMenuSearch();
  }, []);

  // Too many searches: try again by itself once the wait is over (S6.15); offline: once back.
  useEffect(() => {
    if (state.kind !== 'limited') return undefined;
    const timer = setTimeout(() => void latestRun.current(state.q), state.retryAfter * 1000);
    return () => clearTimeout(timer);
  }, [state]);
  useEffect(() => {
    if (online && state.kind === 'offline') void latestRun.current(state.q);
  }, [online, state]);

  // ---------------------------------------------------------------- what shows
  const activeSearch = searched && searched.result.kind !== 'all' ? searched : null;
  const activeQ = activeSearch?.q ?? null;
  const range = rangeOf(query, bounds);
  const priceOn = query.min !== null || query.max !== null;
  const filterOn = activeQ !== null || priceOn;
  const results = searchResults(dishes, activeSearch?.result ?? null).filter((dish) =>
    inRange(dish, range),
  );
  const shownCounts = filterOn ? countByCuisine(results) : counts;
  const total = results.length;
  const searching = state.kind === 'searching';
  const slowSearch = useSlowPending(searching, SEARCH_WAIT_MS);
  const dim = useSlowPending(searching, 150);
  const resultKey = `${activeQ ?? ''}|${query.min ?? ''}|${query.max ?? ''}|${activeSearch?.result.ids.join(',') ?? ''}`;

  // ---------------------------------------------------------------- changes
  const setQuery = (change: Partial<MenuQuery>) => {
    writeAddress({ ...query, q: activeQ ?? '', ...change });
  };

  const selectTab = (value: string) => {
    const cuisine = CUISINES.find((item) => item === value);
    if (cuisine) setQuery({ cuisine, cuisineInAddress: true });
  };

  const setRange = (next: Range) => setQuery(withRange(next, bounds));

  const clearSearch = () => {
    searchLater.cancel();
    setText('');
    void runSearch('');
    fieldRef.current?.focus();
  };

  const clearAll = () => {
    searchLater.cancel();
    requestId.current += 1;
    setText('');
    setSearched(null);
    setState({ kind: 'idle' });
    writeAddress({ ...query, q: '', min: null, max: null });
    fieldRef.current?.focus();
  };

  const searchNow = (value: string) => {
    searchLater.cancel();
    setText(value);
    void runSearch(value);
  };

  // A tab without matches hands over to the first one with matches, and says so (S6.6);
  // otherwise the settled result is announced once (S7.7).
  /** Switches away from a tab left without matches; gives the words to announce. */
  const settle = useEffectEvent((): string | null => {
    const matches = countByCuisine(results);
    const target = matches[query.cuisine] === 0 ? firstWithMatches(matches) : null;
    if (target) {
      writeAddress({ ...query, q: activeQ ?? '', cuisine: target, cuisineInAddress: true });
      return autoSwitchText(query.cuisine, target, activeQ, matches[target]);
    }
    const suggestion =
      activeSearch?.result.kind === 'suggestions' ? activeSearch.result.didYouMean : null;
    if (suggestion && activeQ) return `${noExactText(activeQ, true)} Did you mean ${suggestion}?`;
    if (total === 0 && activeQ) return noResultsText(activeQ, true);
    return resultsText(total, activeQ, priceOn ? range : null, true);
  });
  const announcedKey = useRef<string | null>(null);
  const settleKey = filterOn ? resultKey : null;
  useEffect(() => {
    if (settleKey === null) {
      announcedKey.current = null;
      return undefined;
    }
    if (announcedKey.current === settleKey) return undefined;
    const spoken = settle();
    const timer = setTimeout(() => {
      announcedKey.current = settleKey;
      if (spoken) announce(spoken);
    }, 300);
    return () => clearTimeout(timer);
  }, [settleKey]);

  // ---------------------------------------------------------------- the results row
  let rowLeft: React.ReactNode = null;
  if (state.kind === 'searching' && slowSearch) {
    rowLeft = (
      <span className="flex items-center gap-2">
        <Spinner className="size-4 motion-reduce:animate-none" />
        Searching…
      </span>
    );
  } else if (state.kind === 'slow') {
    rowLeft = (
      <span>
        Search is taking too long.{' '}
        <button type="button" className={linkButton} onClick={() => void runSearch(state.q)}>
          Try again
        </button>
      </span>
    );
  } else if (state.kind === 'limited') {
    rowLeft = "You're searching very fast. Try again in a few seconds.";
  } else if (state.kind === 'offline') {
    rowLeft = SEARCH_OFFLINE;
  } else if (activeSearch?.result.kind === 'suggestions' && activeSearch.result.didYouMean) {
    const suggestion = activeSearch.result.didYouMean;
    rowLeft = (
      <span className="[overflow-wrap:anywhere]">
        {noExactText(activeSearch.q)} Did you mean{' '}
        <button type="button" className={linkButton} onClick={() => searchNow(suggestion)}>
          {suggestion}
        </button>
        ?
      </span>
    );
  } else if (filterOn && total > 0) {
    rowLeft = (
      <span className="[overflow-wrap:anywhere]">
        {resultsText(total, activeQ, priceOn ? range : null)}
      </span>
    );
  }

  const nothingAnywhere = filterOn && total === 0 && !searching;
  const filterCount = (candidate: Range) =>
    searchResults(dishes, activeSearch?.result ?? null).filter((dish) => inRange(dish, candidate))
      .length;

  return (
    <Tabs
      value={query.cuisine}
      onValueChange={selectTab}
      activationMode="automatic"
      className="gap-0"
    >
      <StuckSentinel />
      <div
        data-menu-toolbar
        className="sticky top-0 z-20 -mx-6 mt-10 bg-neutral-8 px-6 py-3 transition-shadow duration-150 data-[stuck=true]:shadow-card md:-mx-12 md:mt-15 md:px-12 lg:static lg:mx-0 lg:mt-15 lg:px-0 lg:py-0 lg:data-[stuck=true]:shadow-none xl:mt-20"
      >
        <div className="flex items-end gap-2 md:gap-3 lg:mx-auto lg:grid lg:max-w-[1000px] lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-x-12 xl:max-w-[1040px]">
          <search aria-label="Menu" className="block min-w-0 flex-1">
            <form
              action="/menu"
              method="get"
              onSubmit={(event) => {
                event.preventDefault();
                searchNow(text);
              }}
            >
              <label
                htmlFor={MENU_SEARCH_ID}
                className="sr-only lg:not-sr-only lg:mb-2 lg:block lg:text-body-4 lg:text-neutral-3"
              >
                Search the menu
              </label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-neutral-3"
                  aria-hidden
                />
                <input
                  ref={fieldRef}
                  id={MENU_SEARCH_ID}
                  name="q"
                  type="search"
                  value={text}
                  placeholder="Try noodles, spicy or pho"
                  enterKeyHint="search"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={100}
                  onChange={(event) => {
                    const value = event.target.value;
                    // Phones: the first keystroke brings the toolbar to the top, above the keyboard.
                    if (!typedOnce.current && window.matchMedia('(width < 64rem)').matches) {
                      scrollMenuToolbarToTop(event.target);
                    }
                    typedOnce.current = true;
                    setText(value);
                    searchLater.maybeExecute(value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape' && text) {
                      event.preventDefault();
                      clearSearch();
                    }
                  }}
                  className="h-12 w-full rounded-lg border border-input bg-white pr-14 pl-12 text-body-4 text-ellipsis placeholder-shown:pr-4 text-neutral-2 shadow-card outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid md:h-14 lg:h-15 lg:text-body-3 [&::-webkit-search-cancel-button]:appearance-none"
                />
                {text ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-touch"
                    aria-label="Clear search"
                    onClick={clearSearch}
                    className="absolute top-1/2 right-1 -translate-y-1/2 rounded-md hover:bg-neutral-7"
                  >
                    <X className="size-5" aria-hidden />
                  </Button>
                ) : null}
              </div>
              {query.cuisineInAddress ? (
                <input type="hidden" name="cuisine" value={params.get('cuisine') ?? ''} />
              ) : null}
              {query.min !== null ? <input type="hidden" name="min" value={query.min} /> : null}
              {query.max !== null ? <input type="hidden" name="max" value={query.max} /> : null}
            </form>
          </search>
          <div className="lg:hidden">
            <FiltersSheet
              bounds={bounds}
              value={range}
              onChange={setRange}
              countFor={filterCount}
              onClearAll={clearAll}
            />
          </div>
          <div className="hidden lg:block">
            <PriceRange bounds={bounds} value={range} onChange={setRange} inline />
          </div>
        </div>
        <div className="mt-3 lg:mt-8 xl:mt-10">
          <CuisineTabList
            counts={shownCounts}
            value={query.cuisine}
            label={filterOn ? matchingTabLabel : undefined}
          />
        </div>
      </div>

      <div className="mt-4 flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 text-body-5 text-neutral-3 md:mt-6 md:text-body-4 xl:mx-auto xl:w-full xl:max-w-[1168px]">
        <div className="min-w-0">{rowLeft}</div>
        {filterOn || text ? (
          // -ml-3: when it wraps under the sentence, its word lines up with the text above;
          // md:-mr-3: on one row, its word ends on the grid's right edge.
          <Button
            type="button"
            variant="ghost"
            onClick={clearAll}
            className="-ml-3 h-11 px-3 md:-mr-3 text-button-2 font-medium text-brand-strong hover:bg-brand-soft hover:text-brand-strong"
          >
            Clear all
          </Button>
        ) : null}
      </div>

      {CUISINES.map((cuisine) => {
        const list = results.filter((dish) => dish.cuisine === cuisine);
        return (
          <CuisinePanel key={cuisine} cuisine={cuisine} className="mt-4 md:mt-8">
            {nothingAnywhere ? (
              <NoResults
                q={activeQ}
                priceOn={priceOn}
                range={range}
                specials={specials}
                onClear={activeQ && !priceOn ? clearSearch : clearAll}
              />
            ) : list.length > 0 ? (
              <DishGrid dishes={list} motionKey={`${cuisine}|${resultKey}`} busy={dim} />
            ) : filterOn ? (
              <TabNoMatches
                cuisine={cuisine}
                counts={shownCounts}
                q={activeQ}
                range={priceOn ? range : null}
                onShowAllPrices={() => setQuery({ min: null, max: null })}
                onGoTo={(target) => selectTab(target)}
              />
            ) : (
              <p className="py-10 text-center text-body-4 text-neutral-3">
                No dishes here yet. Try another cuisine.
              </p>
            )}
          </CuisinePanel>
        );
      })}
    </Tabs>
  );
}

/** Marks the toolbar as stuck once the page has scrolled under it (a shadow; cosmetic). */
function StuckSentinel() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sentinel = ref.current;
    const toolbar = sentinel?.nextElementSibling;
    if (!sentinel || !(toolbar instanceof HTMLElement) || !('IntersectionObserver' in window)) {
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) => {
      toolbar.dataset.stuck = String(entry ? !entry.isIntersecting : false);
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref} aria-hidden className="h-px" />;
}

function TabNoMatches({
  cuisine,
  counts,
  q,
  range,
  onShowAllPrices,
  onGoTo,
}: {
  cuisine: Cuisine;
  counts: CuisineCounts;
  q: string | null;
  range: Range | null;
  onShowAllPrices: () => void;
  onGoTo: (cuisine: Cuisine) => void;
}) {
  const copy = noMatchCopy(cuisine, counts, q, range);
  return (
    <EmptyState
      title={copy.title}
      description={copy.line}
      titleAs="h3"
      className="py-10"
      action={
        <div className="flex flex-wrap justify-center gap-3">
          {copy.resetPrice ? (
            <Button type="button" variant="outline" size="touch" onClick={onShowAllPrices}>
              Show all prices
            </Button>
          ) : null}
          {copy.goTo ? (
            <Button type="button" size="touch" onClick={() => onGoTo(copy.goTo!.cuisine)}>
              {copy.goTo.label}
            </Button>
          ) : null}
        </div>
      }
    />
  );
}

function NoResults({
  q,
  priceOn,
  range,
  specials,
  onClear,
}: {
  q: string | null;
  priceOn: boolean;
  range: Range;
  specials: Dish[];
  onClear: () => void;
}) {
  return (
    <div>
      <EmptyState
        illustration="searching"
        title={q ? noResultsText(q) : `No dishes between $${range.min} and $${range.max}`}
        description="Check the spelling, or try a dish, an ingredient like beef, shrimp or tofu, or a cuisine."
        titleAs="h3"
        action={
          <Button type="button" size="touch" onClick={onClear}>
            {q && !priceOn ? 'Clear search' : 'Clear all'}
          </Button>
        }
      />
      {specials.length > 0 ? (
        <section aria-labelledby="menu-ideas-title" className="mt-12">
          <h3 id="menu-ideas-title" className="font-heading text-title-2 text-neutral-2">
            Ideas from today&apos;s specials
          </h3>
          <ul className="mt-6 grid gap-4 md:grid-cols-3 md:gap-6">
            {specials.slice(0, 3).map((dish) => (
              <li key={dish.id}>
                <DishCard dish={dish} layout="compact" headingLevel="h4" className="h-full" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
