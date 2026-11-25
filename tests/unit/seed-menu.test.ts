import { describe, expect, it } from 'vitest';
import { campaigns, siteSettings } from '../../prisma/seeding/content';
import { menuItems, slugify } from '../../prisma/seeding/menu';
import { openingHoursSchema } from '../../server/modules/menu/schema';
import {
  DISH_SLUG_PATTERN,
  LEGACY_MENU_REDIRECTS,
  menuTabHref,
} from '../../server/modules/menu/urls';

const bySlug = new Map(menuItems.map((dish) => [dish.slug, dish]));
const countOf = (cuisine: string) => menuItems.filter((dish) => dish.cuisine === cuisine).length;

describe('slugify', () => {
  it.each([
    ['Bánh Khọt', 'banh-khot'],
    ['Phở Bò', 'pho-bo'],
    ['Chả Giò', 'cha-gio'],
    ['Cơm Gà', 'com-ga'],
    ['Bánh Mì Đặc Biệt', 'banh-mi-dac-biet'],
    ['Basil, Pork and Fried Eggs', 'basil-pork-and-fried-eggs'],
    ['Korean BBQ', 'korean-bbq'],
    ['  Crème brûlée!  ', 'creme-brulee'],
    ['Pad   Thai', 'pad-thai'],
  ])('turns %j into %j', (name, slug) => {
    expect(slugify(name)).toBe(slug);
  });
});

describe('seeded menu', () => {
  it('has 24 dishes: 12 Korean, 6 Thai, 6 Vietnamese, each with a canonical, unique slug', () => {
    expect(menuItems).toHaveLength(24);
    expect([countOf('KOREAN'), countOf('THAI'), countOf('VIETNAMESE')]).toEqual([12, 6, 6]);
    expect(bySlug.size).toBe(24);
    for (const dish of menuItems) expect(dish.slug).toMatch(DISH_SLUG_PATTERN);
  });

  it('carries the corrected names and descriptions', () => {
    expect(bySlug.get('banh-khot')?.title).toBe('Bánh Khọt');
    expect(bySlug.get('beef-noodle-soup')?.title).toBe('Beef Noodle Soup');
    expect(bySlug.get('egg-stew')?.description).toMatch(/^Khai palo:/);
    for (const removed of [
      'ceviche',
      'croquetas',
      'nasi-lemak',
      'zhanzie-noodle-soup',
      'bahn-khot',
    ]) {
      expect(bySlug.has(removed)).toBe(false);
    }
    expect(
      menuItems.filter((dish) => dish.cuisine === 'VIETNAMESE').map((dish) => dish.title),
    ).toEqual(['Bánh Khọt', 'Hotpot', 'Simple Noodles', 'Phở Bò', 'Chả Giò', 'Cơm Gà']);
  });

  it('keeps the special prices and marks only Naengmyeon sold out', () => {
    const specials = menuItems.filter((dish) => dish.isSpecial);
    expect(specials.map((dish) => [dish.slug, dish.priceCents])).toEqual([
      ['gimbap', 1299],
      ['kimchi', 699],
      ['korean-bbq', 2199],
    ]);
    expect(menuItems.filter((dish) => !dish.isAvailable).map((dish) => dish.slug)).toEqual([
      'naengmyeon',
    ]);
  });

  it('stores prices as whole cents', () => {
    for (const dish of menuItems) expect(Number.isInteger(dish.priceCents)).toBe(true);
  });
});

describe('old dish addresses against the seed', () => {
  it('point at dishes that exist', () => {
    const missing = LEGACY_MENU_REDIRECTS.map(({ to }) => to)
      .filter((to) => !to.startsWith('/menu?'))
      .filter((to) => !bySlug.has(to.replace('/menu/', '')));
    expect(missing).toEqual([]);
  });
});

describe('seeded campaigns and store', () => {
  const now = new Date('2026-11-15T12:00:00Z');
  const seeded = campaigns(now);

  it('opens the Korean tab from the Korean BBQ campaign', () => {
    const bbq = seeded.find((campaign) => campaign.key === 'home-korean-bbq');
    expect(bbq?.ctaHref).toBe(menuTabHref('KOREAN'));
  });

  it('features only dishes that exist and can be ordered', () => {
    const unorderable = seeded
      .flatMap((campaign) => campaign.menuSlugs)
      .filter((slug) => !bySlug.get(slug)?.isAvailable);
    expect(unorderable).toEqual([]);
  });

  it('does not promise special prices that the data cannot show', () => {
    for (const campaign of seeded) expect(campaign.subtitle ?? '').not.toMatch(/special prices/i);
  });

  it('has opening hours the storefront can read', () => {
    expect(openingHoursSchema.safeParse(siteSettings.openingHours).success).toBe(true);
  });

  it('links the footer only to pages that exist, each label naming its page', () => {
    const links = siteSettings.footerLinks.flatMap((group) => group.links);
    expect(links).toEqual([
      { label: 'Home', href: '/' },
      { label: 'Menu', href: '/menu' },
      { label: 'Blog', href: '/blog' },
      { label: 'Contact us', href: '/contact' },
      { label: 'Deliver with Foodz', href: '/deliver' },
    ]);
  });
});
