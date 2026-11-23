import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { PrismaClient } from '@/server/db/generated/client';
import { redis } from '@/server/redis';
import { seedCatalog } from '../../prisma/seeding';

// The action reads the caller's address from the request headers; each test uses its own.
const caller = vi.hoisted(() => ({ ip: '' }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': caller.ip }),
  cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false }),
}));

const { searchMenu } = await import('@/server/modules/menu/service');
const { searchMenuAction } = await import('@/server/modules/menu/actions');

const newCaller = () => {
  caller.ip = `search-${crypto.randomUUID()}`;
};

let migrator: PrismaClient;
const titleOf = new Map<string, string>();

beforeAll(async () => {
  migrator = new PrismaClient({
    adapter: new PrismaPg({ connectionString: inject('migratorUrl') }),
  });
  await migrator.$transaction((tx) => seedCatalog(tx, { now: new Date() }), { timeout: 60_000 });
  for (const dish of await migrator.menuItem.findMany({ select: { id: true, title: true } })) {
    titleOf.set(dish.id, dish.title);
  }
}, 120_000);

afterAll(async () => {
  await migrator.$disconnect();
  await redis.quit();
});

const byName = (a: string | undefined, b: string | undefined) => (a ?? '').localeCompare(b ?? '');

/** Dish names in result order. */
async function titles(q: string) {
  const result = await searchMenu({ q });
  return { ...result, titles: result.ids.map((id) => titleOf.get(id)) };
}

const KOREAN = [
  'Bibimbap',
  'Bulgogi',
  'Gimbap',
  'Jajangmyeon',
  'Kimchi',
  'Kimchi Jjigae',
  'Korean BBQ',
  'Naengmyeon',
  'Beef Noodle Soup',
  'Samgyeopsal',
  'Tteokbokki',
  'Yangnyeom Chicken',
];

describe('searching the menu (S6.2)', () => {
  it('finds noodles in every cuisine: names first, sold out last', async () => {
    const result = await titles('noodles');
    expect(result.kind).toBe('matches');
    expect(result.titles.toSorted(byName)).toEqual(
      [
        'Beef Noodle Soup',
        'Chả Giò',
        'Hotpot',
        'Jajangmyeon',
        'Naengmyeon',
        'Pad Thai',
        'Phở Bò',
        'Simple Noodles',
      ].toSorted(byName),
    );
    expect(result.titles.slice(0, 2).toSorted(byName)).toEqual([
      'Beef Noodle Soup',
      'Simple Noodles',
    ]);
    expect(result.titles.at(-1)).toBe('Naengmyeon');
  });

  it('finds curry, kimchi, spicy and shrimp as the story lists them', async () => {
    expect((await titles('curry')).titles).toEqual(['Green Curry', 'Panang Pork with Rice']);

    const kimchi = (await titles('kimchi')).titles;
    expect(kimchi.slice(0, 2).toSorted(byName)).toEqual(['Kimchi', 'Kimchi Jjigae']);
    expect(kimchi.slice(2)).toEqual(['Samgyeopsal']);

    expect((await titles('spicy')).titles.toSorted(byName)).toEqual(
      [
        'Basil, Pork and Fried Eggs',
        'Fried Thai Rice',
        'Green Curry',
        'Kimchi',
        'Kimchi Jjigae',
        'Panang Pork with Rice',
        'Tteokbokki',
        'Yangnyeom Chicken',
      ].toSorted(byName),
    );
    expect((await titles('shrimp')).titles.toSorted(byName)).toEqual(
      ['Bánh Khọt', 'Chả Giò', 'Fried Thai Rice', 'Pad Thai'].toSorted(byName),
    );
  });

  it('finds every Korean dish by the cuisine name', async () => {
    const result = await titles('korean');
    expect(result.titles.toSorted(byName)).toEqual(KOREAN.toSorted(byName));
    expect(result.titles[0]).toBe('Korean BBQ');
    expect(result.titles.at(-1)).toBe('Naengmyeon');
  });
});

describe('accents, case, spacing and other scripts (S6.3)', () => {
  it('finds Phở Bò without the accents, in any case', async () => {
    for (const q of ['pho', 'PHO', 'pho bo', 'phở', 'Phở Bò']) {
      expect((await titles(q)).titles[0]).toBe('Phở Bò');
    }
  });

  it('finds Vietnamese names and ingredients typed without accents', async () => {
    expect((await titles('banh khot')).titles).toEqual(['Bánh Khọt']);
    expect((await titles('nuoc cham')).titles.toSorted(byName)).toEqual(['Bánh Khọt', 'Chả Giò']);
  });

  it('collapses spaces and finds a Korean name in Hangul', async () => {
    expect((await titles('  pad   THAI ')).titles).toEqual(['Pad Thai']);
    expect((await titles('김밥')).titles).toEqual(['Gimbap']);
  });
});

describe('unfinished words and typos (S6.4, S6.5)', () => {
  it('matches the last word as the start of a word', async () => {
    expect((await titles('bul')).titles).toEqual(['Bulgogi']);
    expect((await titles('jjig')).titles).toEqual(['Kimchi Jjigae']);
    expect((await titles('pad th')).titles).toEqual(['Pad Thai']);
  });

  it('suggests close names when nothing matches exactly', async () => {
    expect(await titles('bulgogy')).toMatchObject({
      kind: 'suggestions',
      didYouMean: 'Bulgogi',
      titles: ['Bulgogi'],
    });
    expect(await titles('pad tai')).toMatchObject({ kind: 'suggestions', didYouMean: 'Pad Thai' });
    expect(await titles('jajangmyun')).toMatchObject({
      kind: 'suggestions',
      didYouMean: 'Jajangmyeon',
    });
  });

  it('says nothing matches a dish that isn’t on the menu (S6.7)', async () => {
    expect(await titles('pizza')).toMatchObject({ kind: 'none', ids: [], didYouMean: null });
  });
});

describe('odd input (S6.8, S6.14)', () => {
  it('treats SQL and patterns as plain words, never as code', async () => {
    expect(await titles("' OR 1=1 --")).toMatchObject({ kind: 'none', ids: [] });
    expect((await titles("pad'; DROP TABLE menu_items; --")).kind).not.toBe('all');
    expect(await migrator.menuItem.count()).toBeGreaterThan(20);
  });

  it('shows the whole menu again for stop words, symbols and control characters', async () => {
    for (const q of ['the', '!!!', '.*', '', '   ', '\u0000', 'the and']) {
      expect(await searchMenu({ q })).toMatchObject({ kind: 'all', ids: [] });
    }
  });

  it('cuts long text to 100 characters', async () => {
    const result = await searchMenu({ q: `noodles ${'x'.repeat(492)}` });
    expect(result.query).toHaveLength(100);
  });
});

describe('the search action', () => {
  it('answers a query and refuses malformed input without detail', async () => {
    newCaller();
    const answer = await searchMenuAction({ q: 'bul' });
    expect(answer?.data?.kind).toBe('matches');
    expect(answer?.data?.ids).toHaveLength(1);

    for (const input of [{ q: 'x'.repeat(1001) }, { q: 42 }, { q: 'pho', pattern: '.*' }, {}]) {
      const result = await searchMenuAction(input as never);
      expect(result?.data).toBeUndefined();
      expect(result?.validationErrors).toBeDefined();
    }
  });

  it('is limited to 60 searches a minute per network, with the real wait (S6.15)', async () => {
    newCaller();
    for (let i = 0; i < 60; i++) {
      expect((await searchMenuAction({ q: 'kimchi' }))?.serverError).toBeUndefined();
    }
    const refused = (await searchMenuAction({ q: 'kimchi' }))?.serverError;
    expect(refused).toMatchObject({ code: 'RATE_LIMITED' });
    expect(refused?.message).toMatch(
      /^You're searching very fast\. Try again in (\d+ seconds?|1 minute)\.$/,
    );
    expect(refused?.retryAfterSeconds).toBeGreaterThan(0);

    newCaller();
    expect((await searchMenuAction({ q: 'kimchi' }))?.data?.kind).toBe('matches');
  });
});
