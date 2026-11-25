import { PrismaPg } from '@prisma/adapter-pg';
import { v7 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { type Prisma, PrismaClient } from '@/server/db/generated/client';
import {
  campaignBannerSchema,
  dishCardSchema,
  dishDetailSchema,
  storeStatusSchema,
} from '@/server/modules/menu/schema';
import {
  countDishesByCuisine,
  getDishBySlug,
  getStoreStatus,
  listActiveCampaigns,
  listAvailableDishes,
  listDishesByCuisine,
  listDishesByIds,
  listDishSuggestions,
  listMenu,
  listSpecials,
} from '@/server/modules/menu/service';
import { seedCatalog } from '../../prisma/seeding';
import { menuItems } from '../../prisma/seeding/menu';

// The catalog is seeded once and shared with the other test files, so rows changed here are
// put back, and rows added here are removed.
let migrator: PrismaClient;
const added = { campaignIds: [] as string[], couponCodes: [] as string[] };

beforeAll(async () => {
  migrator = new PrismaClient({
    adapter: new PrismaPg({ connectionString: inject('migratorUrl') }),
  });
  await migrator.$transaction((tx) => seedCatalog(tx, { now: new Date() }), { timeout: 60_000 });
}, 120_000);

afterAll(async () => {
  await migrator.campaign.deleteMany({ where: { id: { in: added.campaignIds } } });
  await migrator.coupon.deleteMany({ where: { code: { in: added.couponCodes } } });
  await migrator.$disconnect();
});

/** Marks a dish sold out for the duration of a check. */
async function whileSoldOut(slug: string, check: () => Promise<void>) {
  await migrator.menuItem.update({ where: { slug }, data: { isAvailable: false } });
  try {
    await check();
  } finally {
    await migrator.menuItem.update({ where: { slug }, data: { isAvailable: true } });
  }
}

async function addCoupon(
  code: string,
  data: {
    endsAt?: Date;
    usageLimit?: number;
    usedCount?: number;
    startsAt?: Date;
    isActive?: boolean;
    isStoreCredit?: boolean;
    ownerUserId?: string;
  },
) {
  added.couponCodes.push(code);
  await migrator.coupon.create({
    data: { code, type: 'PERCENT', value: 10, startsAt: new Date('2030-12-01T00:00:00Z'), ...data },
  });
}

const carouselTitlesAt = async (at: Date) =>
  (await listActiveCampaigns('HOME_CAROUSEL', at)).map((campaign) => campaign.title);

const dishId = async (slug: string) =>
  (await migrator.menuItem.findUniqueOrThrow({ where: { slug }, select: { id: true } })).id;

describe('menu reads', () => {
  it('lists a cuisine with the sold-out dish last, flagged rather than hidden', async () => {
    const korean = await listDishesByCuisine('KOREAN');
    expect(korean).toHaveLength(12);
    for (const dish of korean) expect(dishCardSchema.safeParse(dish).success).toBe(true);
    expect(korean.at(-1)).toMatchObject({ slug: 'naengmyeon', isAvailable: false });
    expect(korean.slice(0, -1).every((dish) => dish.isAvailable)).toBe(true);

    expect(await listDishesByCuisine('THAI')).toHaveLength(6);
    const vietnamese = await listDishesByCuisine('VIETNAMESE');
    expect(vietnamese.map((dish) => dish.title)).toEqual([
      'Bánh Khọt',
      'Chả Giò',
      'Cơm Gà',
      'Hotpot',
      'Phở Bò',
      'Simple Noodles',
    ]);
  });

  it('counts the dishes behind each tab, sold-out ones included', async () => {
    expect(await countDishesByCuisine()).toEqual({ KOREAN: 12, THAI: 6, VIETNAMESE: 6 });
  });

  it('loads the whole menu at once, tab by tab, sold-out dishes last in their tab', async () => {
    const menu = await listMenu();
    expect(menu).toHaveLength(24);
    expect(menu.map((dish) => dish.cuisine)).toEqual([
      ...Array<string>(12).fill('KOREAN'),
      ...Array<string>(6).fill('THAI'),
      ...Array<string>(6).fill('VIETNAMESE'),
    ]);
    expect(menu[11]).toMatchObject({ slug: 'naengmyeon', isAvailable: false });
    expect(menu.filter((dish) => dish.cuisine === 'THAI')).toEqual(
      await listDishesByCuisine('THAI'),
    );
  });

  it('lists only dishes that can be ordered for the taste picker', async () => {
    const dishes = await listAvailableDishes();
    expect(dishes).toHaveLength(23);
    expect(dishes.some((dish) => dish.slug === 'naengmyeon')).toBe(false);
    expect([...new Set(dishes.map((dish) => dish.cuisine))]).toEqual([
      'KOREAN',
      'THAI',
      'VIETNAMESE',
    ]);
  });

  it('shows the same price and rating on the card, in the specials and on the dish page', async () => {
    const specials = await listSpecials();
    // Korean BBQ leads: it is the special with a running offer (the KBBQ5 campaign).
    expect(specials.map((dish) => [dish.slug, dish.priceCents])).toEqual([
      ['korean-bbq', 2199],
      ['gimbap', 1299],
      ['kimchi', 699],
    ]);
    expect(specials[0]?.offer).toMatchObject({ title: 'Korean BBQ weekend' });

    const korean = await listDishesByCuisine('KOREAN');
    for (const special of specials) {
      const card = korean.find((dish) => dish.slug === special.slug);
      const page = await getDishBySlug(special.slug);
      expect(card).toEqual(special);
      expect(page).toMatchObject(special);
      expect(special.ratingCount).toBeGreaterThan(0);
    }
  });

  it('opens a dish page with its own description, flavors and prep time', async () => {
    const dish = await getDishBySlug('banh-khot');
    const seeded = menuItems.find((item) => item.slug === 'banh-khot');
    expect(dishDetailSchema.safeParse(dish).success).toBe(true);
    expect(dish).toMatchObject({
      title: 'Bánh Khọt',
      cuisine: 'VIETNAMESE',
      image: '/Menu/Vietnamese/BanhKhot.svg',
      images: ['/Menu/Vietnamese/BanhKhot.svg'],
      flavors: seeded?.flavors,
      prepMinutes: seeded?.prepMinutes,
      description: seeded?.description,
    });

    expect(await getDishBySlug('bulgogi')).toMatchObject({ image: null, images: [] });
  });

  it.each(['does-not-exist', 'BULGOGI', 'x'.repeat(300), '\u0000', '../admin', 'pad thai'])(
    'answers null for the slug %j',
    async (slug) => {
      expect(await getDishBySlug(slug)).toBeNull();
    },
  );

  it('opens a sold-out dish and suggests available dishes of the same cuisine', async () => {
    const dish = await getDishBySlug('naengmyeon');
    expect(dish).toMatchObject({ isAvailable: false, cuisine: 'KOREAN' });

    const suggestions = await listDishSuggestions({ id: dish!.id, cuisine: dish!.cuisine });
    expect(suggestions).toHaveLength(3);
    for (const suggestion of suggestions) {
      expect(suggestion).toMatchObject({ cuisine: 'KOREAN', isAvailable: true });
      expect(suggestion.slug).not.toBe('naengmyeon');
    }
  });

  it('marks the most ordered dish of each cuisine as the best seller', async () => {
    const all = [
      ...(await listDishesByCuisine('KOREAN')),
      ...(await listDishesByCuisine('THAI')),
      ...(await listDishesByCuisine('VIETNAMESE')),
    ];
    const flagged = all.filter((dish) => dish.isBestSeller).map((dish) => dish.slug);

    const expected = ['KOREAN', 'THAI', 'VIETNAMESE'].map(
      (cuisine) =>
        menuItems
          .filter((dish) => dish.cuisine === cuisine)
          .toSorted((a, b) => b.soldCount - a.soldCount || a.title.localeCompare(b.title))[0]
          ?.slug ?? '',
    );
    expect(flagged.toSorted((a, b) => a.localeCompare(b))).toEqual(
      expected.toSorted((a, b) => a.localeCompare(b)),
    );
  });

  it('leaves a sold-out dish out of the specials but keeps it on its tab', async () => {
    await whileSoldOut('kimchi', async () => {
      expect((await listSpecials()).map((dish) => dish.slug)).toEqual(['korean-bbq', 'gimbap']);
      const korean = await listDishesByCuisine('KOREAN');
      expect(korean.find((dish) => dish.slug === 'kimchi')).toMatchObject({ isAvailable: false });
    });
  });

  it('checks dishes again by id, leaving out ids that match nothing', async () => {
    const [gimbap, naengmyeon] = await Promise.all([dishId('gimbap'), dishId('naengmyeon')]);
    const dishes = await listDishesByIds({ ids: [naengmyeon, gimbap, gimbap, uuid()] });
    expect(dishes.map((dish) => [dish.slug, dish.isAvailable])).toEqual([
      ['gimbap', true],
      ['naengmyeon', false],
    ]);
    await expect(listDishesByIds({ ids: ['gimbap'] })).rejects.toThrow('Invalid UUID');
  });
});

describe('campaigns', () => {
  it('shows the seeded campaigns with their coupons and links', async () => {
    const [carousel, ...otherCarousels] = await listActiveCampaigns('HOME_CAROUSEL');
    expect(otherCarousels).toEqual([]);
    expect(campaignBannerSchema.safeParse(carousel).success).toBe(true);
    expect(carousel).toMatchObject({
      title: 'Korean BBQ weekend',
      subtitle: '$5 off Korean dishes over $25 with code KBBQ5',
      cta: { label: 'Order now', href: '/menu?cuisine=korean' },
      coupon: {
        code: 'KBBQ5',
        type: 'FIXED',
        amountOffCents: 500,
        percentOff: null,
        minSubtotalCents: 2500,
        cuisines: ['KOREAN'],
      },
    });
    expect(carousel?.dishes.map((dish) => dish.slug)).toEqual([
      'bulgogi',
      'korean-bbq',
      'samgyeopsal',
      'yangnyeom-chicken',
    ]);

    const [bar] = await listActiveCampaigns('ANNOUNCEMENT_BAR');
    expect(bar).toMatchObject({
      title: 'Free delivery on orders over $30',
      cta: null,
      coupon: { code: 'FREEDELIVERY', type: 'FREE_DELIVERY', minSubtotalCents: 3000 },
    });

    const [specials] = await listActiveCampaigns('MENU_TOP');
    expect(specials).toMatchObject({ title: "Today's specials", cta: null, coupon: null });
    expect(specials?.dishes.map((dish) => dish.slug)).toEqual(['gimbap', 'kimchi', 'korean-bbq']);
  });

  it('never advertises a sold-out dish', async () => {
    await whileSoldOut('bulgogi', async () => {
      const [carousel] = await listActiveCampaigns('HOME_CAROUSEL');
      expect(carousel?.dishes.map((dish) => dish.slug)).not.toContain('bulgogi');
    });
  });

  it('is gone once the seeded schedule has ended', async () => {
    const later = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
    expect(await listActiveCampaigns('HOME_CAROUSEL', later)).toEqual([]);
    expect(await listActiveCampaigns('ANNOUNCEMENT_BAR', later)).toEqual([]);
  });

  describe('schedule and switches (campaigns in 2031)', () => {
    const startsAt = new Date('2031-01-01T00:00:00.000Z');
    const endsAt = new Date('2031-01-08T00:00:00.000Z');
    const during = new Date('2031-01-04T12:00:00.000Z');

    async function addCampaign(
      title: string,
      options: { isActive?: boolean; couponCode?: string; ctaHref?: string } = {},
    ) {
      const { id } = await migrator.campaign.create({
        data: {
          title,
          placement: 'HOME_CAROUSEL',
          startsAt,
          endsAt,
          isActive: options.isActive ?? true,
          ctaLabel: 'Order now',
          ctaHref: options.ctaHref ?? '/menu?cuisine=thai',
          coupon: options.couponCode ? { connect: { code: options.couponCode } } : undefined,
          menuItems: { connect: [{ slug: 'pad-thai' }] },
        },
        select: { id: true },
      });
      added.campaignIds.push(id);
      return id;
    }

    beforeAll(async () => {
      await addCoupon('TEST-LIVE', {});
      await addCoupon('TEST-EXPIRED', { endsAt: new Date('2030-12-31T00:00:00Z') });
      await addCoupon('TEST-USED-UP', { usageLimit: 1, usedCount: 1 });
      // Codes that belong to one customer or cannot be used yet must never be advertised.
      await addCoupon('TEST-PERSONAL', { ownerUserId: uuid() });
      // Store credit always has an owner (coupons_store_credit_owner).
      await addCoupon('TEST-CREDIT', { isStoreCredit: true, ownerUserId: uuid() });
      await addCoupon('TEST-COUPON-OFF', { isActive: false });
      await addCoupon('TEST-NOT-YET', { startsAt: new Date('2031-01-05T00:00:00Z') });
      await addCampaign('Window');
      await addCampaign('Switched off', { isActive: false });
      await addCampaign('Live coupon', { couponCode: 'TEST-LIVE' });
      await addCampaign('Expired coupon', { couponCode: 'TEST-EXPIRED' });
      await addCampaign('Used-up coupon', { couponCode: 'TEST-USED-UP' });
      await addCampaign('Personal coupon', { couponCode: 'TEST-PERSONAL' });
      await addCampaign('Store credit', { couponCode: 'TEST-CREDIT' });
      await addCampaign('Coupon switched off', { couponCode: 'TEST-COUPON-OFF' });
      await addCampaign('Coupon not started', { couponCode: 'TEST-NOT-YET' });
      await addCampaign('Off-site link', { ctaHref: 'https://evil.example/' });
    });

    it('starts at its start time and ends at its end time', async () => {
      expect(await carouselTitlesAt(new Date(startsAt.getTime() - 1))).toEqual([]);
      expect(await carouselTitlesAt(startsAt)).toContain('Window');
      expect(await carouselTitlesAt(new Date(endsAt.getTime() - 1))).toContain('Window');
      expect(await carouselTitlesAt(endsAt)).toEqual([]);
    });

    it('hides switched-off campaigns and ones whose coupon cannot be used', async () => {
      const titles = await carouselTitlesAt(during);
      expect(titles).toEqual(expect.arrayContaining(['Window', 'Live coupon', 'Off-site link']));
      expect(titles).not.toContain('Switched off');
      expect(titles).not.toContain('Expired coupon');
      expect(titles).not.toContain('Used-up coupon');
    });

    it('never advertises a personal code, store credit, or a code that is off or not started', async () => {
      const campaigns = await listActiveCampaigns('HOME_CAROUSEL', during);
      const titles = campaigns.map((campaign) => campaign.title);
      for (const title of [
        'Personal coupon',
        'Store credit',
        'Coupon switched off',
        'Coupon not started',
      ]) {
        expect(titles).not.toContain(title);
      }
      const codes = campaigns.map((campaign) => campaign.coupon?.code);
      for (const code of ['TEST-PERSONAL', 'TEST-CREDIT', 'TEST-COUPON-OFF', 'TEST-NOT-YET']) {
        expect(codes).not.toContain(code);
      }
      // The dish page's offer badge never points at them either.
      expect((await getDishBySlug('pad-thai', during))?.offer?.title).toBe('Live coupon');
    });

    it('drops a button that would leave the site', async () => {
      const campaigns = await listActiveCampaigns('HOME_CAROUSEL', during);
      expect(campaigns.find((campaign) => campaign.title === 'Off-site link')?.cta).toBeNull();
      expect(campaigns.find((campaign) => campaign.title === 'Window')?.cta).toEqual({
        label: 'Order now',
        href: '/menu?cuisine=thai',
      });
    });

    it('gives a featured dish the end time of its running coupon campaign', async () => {
      const dish = await getDishBySlug('pad-thai', during);
      expect(dish?.offer).toMatchObject({ title: 'Live coupon', endsAt: endsAt.toISOString() });
      expect((await getDishBySlug('pad-thai', endsAt))?.offer).toBeNull();
    });
  });

  it('times the offer badge from the seeded Korean BBQ campaign, not from campaigns without a coupon', async () => {
    const bbq = await migrator.campaign.findFirstOrThrow({
      where: { title: 'Korean BBQ weekend' },
      select: { id: true, endsAt: true },
    });
    expect((await getDishBySlug('yangnyeom-chicken'))?.offer).toEqual({
      campaignId: bbq.id,
      title: 'Korean BBQ weekend',
      endsAt: bbq.endsAt.toISOString(),
    });
    // Gimbap is only in "Today's specials", which has no coupon and so no deadline.
    expect((await getDishBySlug('gimbap'))?.offer).toBeNull();
  });

  it('features the best seller, then the first special by name, when no special has an offer', async () => {
    const where = { title: 'Korean BBQ weekend' };
    await migrator.campaign.updateMany({ where, data: { isActive: false } });
    try {
      const specials = await listSpecials();
      expect(specials.every((dish) => dish.offer === null)).toBe(true);
      const expected = specials.find((dish) => dish.isBestSeller)?.slug ?? 'gimbap';
      expect(specials[0]?.slug).toBe(expected);
      expect(await listActiveCampaigns('HOME_CAROUSEL')).toEqual([]);
    } finally {
      await migrator.campaign.updateMany({ where, data: { isActive: true } });
    }
  });
});

describe('store status', () => {
  // Sunday 20:59 in Boston.
  const sundayEvening = new Date('2026-11-16T01:59:00Z');

  it('works out opening times from the store settings', async () => {
    const status = await getStoreStatus(sundayEvening);
    expect(storeStatusSchema.safeParse(status).success).toBe(true);
    expect(status).toMatchObject({
      timeZone: 'America/New_York',
      at: '2026-11-16T01:59:00.000Z',
      isOpen: true,
      closesAt: { at: '2026-11-16T02:00:00.000Z', weekday: 'sun', time: '21:00', day: 'today' },
      opensAt: null,
      today: 'sun',
      store: {
        name: 'Foodz',
        addressText: '88 Harbor Street, Boston, MA 02210',
        phone: '+1 617 555 0142',
        email: 'hello@foodz.example',
      },
      footerLinks: [
        {
          title: 'Explore',
          links: [
            { label: 'Home', href: '/' },
            { label: 'Menu', href: '/menu' },
            { label: 'Blog', href: '/blog' },
          ],
        },
        {
          title: 'Help',
          links: [
            { label: 'Contact us', href: '/contact' },
            { label: 'Deliver with Foodz', href: '/deliver' },
          ],
        },
      ],
      delivery: { promiseMinutes: 45, radiusKm: 8, baseFeeCents: 199, perKmFeeCents: 50 },
    });
    expect(status.weeklyHours.map((day) => day.weekday)).toEqual([
      'mon',
      'tue',
      'wed',
      'thu',
      'fri',
      'sat',
      'sun',
    ]);
    expect(status.weeklyHours[0]).toEqual({
      weekday: 'mon',
      hours: { open: '11:00', close: '22:00' },
    });
  });

  it('follows a change to the hours straight away', async () => {
    const { openingHours } = await migrator.siteSettings.findUniqueOrThrow({
      where: { id: 1 },
      select: { openingHours: true },
    });
    const withSundayClosed = { ...(openingHours as Record<string, unknown>), sun: null };
    await migrator.siteSettings.update({
      where: { id: 1 },
      data: { openingHours: withSundayClosed },
    });
    try {
      const status = await getStoreStatus(sundayEvening);
      expect(status.isOpen).toBe(false);
      expect(status.opensAt).toMatchObject({ weekday: 'mon', time: '11:00', day: 'tomorrow' });
      expect(status.weeklyHours.at(-1)).toEqual({ weekday: 'sun', hours: null });
    } finally {
      await migrator.siteSettings.update({
        where: { id: 1 },
        data: { openingHours: openingHours as Prisma.InputJsonValue },
      });
    }
  });

  it('drops footer links that would run script or leave through a protocol-relative URL', async () => {
    const { footerLinks } = await migrator.siteSettings.findUniqueOrThrow({
      where: { id: 1 },
      select: { footerLinks: true },
    });
    await migrator.siteSettings.update({
      where: { id: 1 },
      data: {
        footerLinks: [
          {
            title: 'Mixed',
            links: [
              { label: 'Menu', href: '/menu' },
              { label: 'Script', href: 'javascript:alert(1)' },
              { label: 'Elsewhere', href: '//evil.example' },
              { label: 'Instagram', href: 'https://instagram.com/foodz' },
            ],
          },
          { title: 'Only bad', links: [{ label: 'Plain', href: 'http://evil.example' }] },
        ],
      },
    });
    try {
      expect((await getStoreStatus(sundayEvening)).footerLinks).toEqual([
        {
          title: 'Mixed',
          links: [
            { label: 'Menu', href: '/menu' },
            { label: 'Instagram', href: 'https://instagram.com/foodz' },
          ],
        },
      ]);
    } finally {
      await migrator.siteSettings.update({
        where: { id: 1 },
        data: { footerLinks: footerLinks as Prisma.InputJsonValue },
      });
    }
  });
});

describe('catalog tables', () => {
  it('have no row-level security, except coupons, whose personal codes only their owner sees', async () => {
    const tables = await migrator.$queryRaw<{ name: string; rls: boolean }[]>`
      SELECT relname AS name, relrowsecurity AS rls
      FROM pg_class
      WHERE relname IN ('menu_items', 'campaigns', '_CampaignToMenuItem', 'coupons', 'site_settings')
        AND relkind = 'r'
      ORDER BY relname COLLATE "C"`;
    expect(tables).toEqual([
      { name: '_CampaignToMenuItem', rls: false },
      { name: 'campaigns', rls: false },
      { name: 'coupons', rls: true },
      { name: 'menu_items', rls: false },
      { name: 'site_settings', rls: false },
    ]);
  });
});
