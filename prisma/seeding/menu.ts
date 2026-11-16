import {
  flavors as flavorOptions,
  koreanMenu,
  SpecialOffersContent,
  ThaiMenu,
  VietnameseMenu,
} from '../../constants';

export type Cuisine = 'KOREAN' | 'THAI' | 'VIETNAMESE';

export interface SeedMenuItem {
  slug: string;
  title: string;
  description: string;
  priceCents: number;
  cuisine: Cuisine;
  images: string[];
  flavors: string[];
  prepMinutes: number;
  isSpecial: boolean;
  ratingAvg: number;
  ratingCount: number;
  soldCount: number;
}

export const slugify = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const cents = (dollars: number) => Math.round(dollars * 100);

// The constants list has a typo ("Rice win vinegar").
const FLAVORS = flavorOptions.map((flavor) => flavor.replace('Rice win', 'Rice wine'));

/** A stable number per dish, so demo ratings and counts look varied but never change. */
function hash(value: string) {
  let h = 2166136261;
  for (const char of value) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return h >>> 0;
}

function demoStats(slug: string) {
  const h = hash(slug);
  return {
    flavors: FLAVORS.filter((_, index) => (h >> index) & 1).slice(0, 4),
    prepMinutes: 12 + (h % 4) * 4,
    ratingAvg: Math.round((4.2 + (h % 8) / 10) * 10) / 10,
    ratingCount: 40 + (h % 260),
    soldCount: 120 + (h % 1400),
  };
}

const specials = new Map(SpecialOffersContent.map((offer) => [offer.title, offer]));

function fromConstants(
  items: { title: string; price: number; imgSrc: string; description: string }[],
  cuisine: Cuisine,
): SeedMenuItem[] {
  return items.map((item) => {
    const slug = slugify(item.title);
    const special = specials.get(item.title);
    return {
      slug,
      title: item.title,
      description: item.description,
      priceCents: cents(special?.price ?? item.price),
      cuisine,
      images: [item.imgSrc],
      isSpecial: Boolean(special),
      ...demoStats(slug),
    };
  });
}

/**
 * Dishes that appear in the design file but not in the original menu. Their photos are added
 * once the image licenses are confirmed; until then the UI shows its placeholder.
 */
const figmaDishes: Omit<SeedMenuItem, keyof ReturnType<typeof demoStats> | 'slug' | 'isSpecial'>[] =
  [
    {
      title: 'Bibimbap',
      description:
        'Warm rice topped with seasoned vegetables, marinated beef and a fried egg, served with gochujang to mix through at the table.',
      priceCents: 1699,
      cuisine: 'KOREAN',
      images: [],
    },
    {
      title: 'Bulgogi',
      description:
        'Thin slices of beef marinated in soy, pear, garlic and sesame, seared over high heat and served with rice and lettuce wraps.',
      priceCents: 2299,
      cuisine: 'KOREAN',
      images: [],
    },
    {
      title: 'Naengmyeon',
      description:
        'Chewy buckwheat noodles in an icy, tangy beef broth with cucumber, pear and a boiled egg. Best on a hot day.',
      priceCents: 1599,
      cuisine: 'KOREAN',
      images: [],
    },
    {
      title: 'Samgyeopsal',
      description:
        'Thick-cut grilled pork belly with ssamjang, garlic and kimchi, ready to wrap in fresh lettuce leaves.',
      priceCents: 2499,
      cuisine: 'KOREAN',
      images: [],
    },
    {
      title: 'Tteokbokki',
      description:
        'Soft rice cakes and fish cakes simmered in a sweet and spicy gochujang sauce, finished with scallions and sesame.',
      priceCents: 1299,
      cuisine: 'KOREAN',
      images: [],
    },
  ];

const koreaBbq = SpecialOffersContent.find((offer) => offer.title === 'Korea BBQ');

export const menuItems: SeedMenuItem[] = [
  ...fromConstants(koreanMenu, 'KOREAN'),
  ...fromConstants(VietnameseMenu, 'VIETNAMESE'),
  ...fromConstants(ThaiMenu, 'THAI'),
  ...(koreaBbq
    ? [
        {
          slug: 'korean-bbq',
          title: 'Korean BBQ',
          description:
            'A grill platter of marinated short rib, pork belly and chicken with banchan, rice and dipping sauces.',
          priceCents: cents(koreaBbq.price),
          cuisine: 'KOREAN' as const,
          images: [koreaBbq.imageSrc],
          isSpecial: true,
          ...demoStats('korean-bbq'),
        },
      ]
    : []),
  ...figmaDishes.map((dish): SeedMenuItem => {
    const slug = slugify(dish.title);
    return Object.assign(dish, { slug, isSpecial: false }, demoStats(slug));
  }),
];
