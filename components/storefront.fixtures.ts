import type {
  CampaignBanner,
  CuisineCounts,
  DishCard,
  StoreMoment,
  StoreStatus,
} from '@/server/modules/menu/schema';

/*
 * Sample storefront data for Storybook, matching the seeded menu, campaigns and store settings.
 * Only stories import this module.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Offers end a little under 30 days from now, as after a fresh seed. */
export const OFFER_ENDS_AT = new Date(Date.now() + 29.5 * DAY_MS).toISOString();
const STARTED_AT = new Date(Date.now() - 0.5 * DAY_MS).toISOString();

const KBBQ_CAMPAIGN_ID = '0196a1b2-0000-7000-8000-000000000101';
const offer = { campaignId: KBBQ_CAMPAIGN_ID, title: 'Korean BBQ weekend', endsAt: OFFER_ENDS_AT };

function dish(
  number: number,
  fields: Pick<DishCard, 'slug' | 'title' | 'cuisine' | 'priceCents' | 'image'> & Partial<DishCard>,
): DishCard {
  return {
    id: `0196a1b2-0000-7000-8000-${String(number).padStart(12, '0')}`,
    ratingAvg: 4.5,
    ratingCount: 100,
    isSpecial: false,
    isAvailable: true,
    isBestSeller: false,
    offer: null,
    ...fields,
  };
}

export const gimbap = dish(1, {
  slug: 'gimbap',
  title: 'Gimbap',
  cuisine: 'KOREAN',
  priceCents: 1299,
  image: '/Menu/Korean/gimbap.svg',
  ratingAvg: 4.9,
  ratingCount: 215,
  isSpecial: true,
});

export const kimchi = dish(2, {
  slug: 'kimchi',
  title: 'Kimchi',
  cuisine: 'KOREAN',
  priceCents: 699,
  image: '/Menu/Korean/kimchi.svg',
  ratingAvg: 4.4,
  ratingCount: 210,
  isSpecial: true,
});

export const koreanBbq = dish(3, {
  slug: 'korean-bbq',
  title: 'Korean BBQ',
  cuisine: 'KOREAN',
  priceCents: 2199,
  image: '/Home/SpecialOffers/koreabbq.svg',
  ratingAvg: 4.5,
  ratingCount: 267,
  isSpecial: true,
  offer,
});

/** No photo yet: the placeholder plate. */
export const bulgogi = dish(4, {
  slug: 'bulgogi',
  title: 'Bulgogi',
  cuisine: 'KOREAN',
  priceCents: 2299,
  image: null,
  ratingAvg: 4.6,
  ratingCount: 120,
  offer,
});

export const samgyeopsal = dish(5, {
  slug: 'samgyeopsal',
  title: 'Samgyeopsal',
  cuisine: 'KOREAN',
  priceCents: 2499,
  image: null,
  ratingAvg: 4.6,
  ratingCount: 84,
  offer,
});

export const yangnyeomChicken = dish(6, {
  slug: 'yangnyeom-chicken',
  title: 'Yangnyeom Chicken',
  cuisine: 'KOREAN',
  priceCents: 2199,
  image: '/Menu/Korean/yagnyeom.svg',
  ratingAvg: 4.4,
  ratingCount: 70,
  isBestSeller: true,
  offer,
});

/** Sold out today. */
export const naengmyeon = dish(7, {
  slug: 'naengmyeon',
  title: 'Naengmyeon',
  cuisine: 'KOREAN',
  priceCents: 1599,
  image: null,
  ratingAvg: 4.6,
  ratingCount: 288,
  isAvailable: false,
});

export const jajangmyeon = dish(8, {
  slug: 'jajangmyeon',
  title: 'Jajangmyeon',
  cuisine: 'KOREAN',
  priceCents: 2199,
  image: '/Menu/Korean/jajangmyeon.svg',
  ratingAvg: 4.4,
  ratingCount: 230,
});

/** The longest name on the menu. */
export const basilPork = dish(9, {
  slug: 'basil-pork-and-fried-eggs',
  title: 'Basil, Pork and Fried Eggs',
  cuisine: 'THAI',
  priceCents: 2199,
  image: '/Menu/Thai/basil.svg',
  ratingAvg: 4.5,
  ratingCount: 103,
  isBestSeller: true,
});

export const padThai = dish(10, {
  slug: 'pad-thai',
  title: 'Pad Thai',
  cuisine: 'THAI',
  priceCents: 2199,
  image: '/Menu/Thai/pad.svg',
  ratingAvg: 4.5,
  ratingCount: 83,
});

export const greenCurry = dish(11, {
  slug: 'green-curry',
  title: 'Green Curry',
  cuisine: 'THAI',
  priceCents: 1999,
  image: '/Menu/Thai/green.svg',
  ratingAvg: 4.4,
  ratingCount: 130,
});

export const phoBo = dish(12, {
  slug: 'pho-bo',
  title: 'Phở Bò',
  cuisine: 'VIETNAMESE',
  priceCents: 1699,
  image: '/Menu/Vietnamese/pho.svg',
  ratingAvg: 4.4,
  ratingCount: 250,
});

/** A new dish nobody has reviewed yet. */
export const unreviewed = dish(13, {
  slug: 'com-ga',
  title: 'Cơm Gà',
  cuisine: 'VIETNAMESE',
  priceCents: 1599,
  image: '/Menu/Vietnamese/chicken.svg',
  ratingAvg: 0,
  ratingCount: 0,
});

/** Korean, Thai and Vietnamese: available dishes first, sold-out ones last, as the menu lists them. */
export const menuDishes: DishCard[] = [
  bulgogi,
  gimbap,
  jajangmyeon,
  kimchi,
  koreanBbq,
  samgyeopsal,
  yangnyeomChicken,
  naengmyeon,
  basilPork,
  greenCurry,
  padThai,
  unreviewed,
  phoBo,
];

export const menuCounts: CuisineCounts = { KOREAN: 8, THAI: 3, VIETNAMESE: 2 };

export const koreanBbqCampaign: CampaignBanner = {
  id: KBBQ_CAMPAIGN_ID,
  placement: 'HOME_CAROUSEL',
  title: 'Korean BBQ weekend',
  subtitle: '$5 off Korean dishes over $25 with code KBBQ5',
  image: null,
  cta: { label: 'Order now', href: '/menu?cuisine=korean' },
  startsAt: STARTED_AT,
  endsAt: OFFER_ENDS_AT,
  coupon: {
    code: 'KBBQ5',
    description: '$5 off Korean dishes over $25',
    type: 'FIXED',
    percentOff: null,
    amountOffCents: 500,
    minSubtotalCents: 2500,
    maxDiscountCents: null,
    cuisines: ['KOREAN'],
    endsAt: OFFER_ENDS_AT,
  },
  dishes: [bulgogi, koreanBbq, samgyeopsal, yangnyeomChicken],
};

export const thaiCurryCampaign: CampaignBanner = {
  ...koreanBbqCampaign,
  id: '0196a1b2-0000-7000-8000-000000000102',
  title: 'Thai curry week',
  subtitle: '10% off every Thai dish',
  cta: { label: 'Order now', href: '/menu?cuisine=thai' },
  coupon: {
    code: 'CURRY10',
    description: '10% off Thai dishes',
    type: 'PERCENT',
    percentOff: 10,
    amountOffCents: null,
    minSubtotalCents: 0,
    maxDiscountCents: 1000,
    cuisines: ['THAI'],
    endsAt: OFFER_ENDS_AT,
  },
  dishes: [basilPork, greenCurry, padThai],
};

const moment = (
  weekday: StoreMoment['weekday'],
  time: string,
  day: StoreMoment['day'],
): StoreMoment => ({ at: OFFER_ENDS_AT, weekday, time, day });

const baseStatus: StoreStatus = {
  timeZone: 'America/New_York',
  at: STARTED_AT,
  today: 'mon',
  isOpen: true,
  closesAt: null,
  opensAt: null,
  weeklyHours: [
    { weekday: 'mon', hours: { open: '11:00', close: '22:00' } },
    { weekday: 'tue', hours: { open: '11:00', close: '22:00' } },
    { weekday: 'wed', hours: { open: '11:00', close: '22:00' } },
    { weekday: 'thu', hours: { open: '11:00', close: '22:00' } },
    { weekday: 'fri', hours: { open: '11:00', close: '23:00' } },
    { weekday: 'sat', hours: { open: '12:00', close: '23:00' } },
    { weekday: 'sun', hours: { open: '12:00', close: '21:00' } },
  ],
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
    { title: 'Help', links: [{ label: 'Contact us', href: '/contact' }] },
  ],
  delivery: { promiseMinutes: 45, radiusKm: 8, baseFeeCents: 199, perKmFeeCents: 50 },
};

/** Monday afternoon: "Open now · until 10 pm". */
export const openStatus: StoreStatus = {
  ...baseStatus,
  today: 'mon',
  isOpen: true,
  closesAt: moment('mon', '22:00', 'today'),
};

/** Sunday 9 pm: "Closed · opens 11 am tomorrow". */
export const closedUntilTomorrow: StoreStatus = {
  ...baseStatus,
  today: 'sun',
  isOpen: false,
  opensAt: moment('mon', '11:00', 'tomorrow'),
};

/** Closed for a few days (a holiday): "opens 12 pm Saturday". */
export const closedUntilSaturday: StoreStatus = {
  ...baseStatus,
  today: 'wed',
  isOpen: false,
  opensAt: moment('sat', '12:00', 'later'),
};
