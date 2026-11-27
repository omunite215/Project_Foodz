import { koreanMenu, SpecialOffersContent, ThaiMenu, VietnameseMenu } from '../../constants';

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
  isAvailable: boolean;
  ratingAvg: number;
  ratingCount: number;
  /** F9 (U17): the same figures, as the baseline real ratings add to. */
  ratingBaseAvg: number;
  ratingBaseCount: number;
  soldCount: number;
}

/** A URL slug from a dish name. Accents are dropped: "Bánh Khọt" becomes "banh-khot". */
export const slugify = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    // The one Vietnamese letter that does not decompose into a base letter and an accent.
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const cents = (dollars: number) => Math.round(dollars * 100);

/**
 * Optional seasonings a customer can ask for, by cuisine. (The original list offered strawberry
 * jam and gochujang on every dish.)
 */
const FLAVORS: Record<Cuisine, string[]> = {
  KOREAN: ['Gochujang', 'Sesame oil', 'Garlic', 'Spring onion', 'Toasted sesame', 'Soy sauce'],
  THAI: ['Thai chili', 'Thai basil', 'Lime', 'Fish sauce', 'Crushed peanuts', 'Coriander'],
  VIETNAMESE: ['Fresh herbs', 'Lime', 'Sliced chili', 'Nước chấm', 'Hoisin', 'Fried shallots'],
};

/** A stable number per dish, so demo ratings and counts look varied but never change. */
function hash(value: string) {
  let h = 2166136261;
  for (const char of value) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return h >>> 0;
}

function demoStats(slug: string, cuisine: Cuisine) {
  const h = hash(slug);
  const ratingAvg = Math.round((4.2 + (h % 8) / 10) * 10) / 10;
  const ratingCount = 40 + (h % 260);
  return {
    flavors: FLAVORS[cuisine].filter((_, index) => (h >> index) & 1).slice(0, 4),
    prepMinutes: 12 + (h % 4) * 4,
    ratingAvg,
    ratingCount,
    ratingBaseAvg: ratingAvg,
    ratingBaseCount: ratingCount,
    soldCount: 120 + (h % 1400),
  };
}

type DishContent = Pick<SeedMenuItem, 'title' | 'description' | 'priceCents' | 'images'>;

/**
 * Corrections to the original menu constants, keyed by the name used there. Null leaves the
 * dish out: Ceviche, Croquetas and Nasi Lemak were listed as Vietnamese but are not, and are
 * replaced by the Vietnamese dishes below. The constants stay untouched; the storefront reads
 * the menu from the database.
 */
const CORRECTIONS: Record<string, Pick<SeedMenuItem, 'title' | 'description'> | null> = {
  'Bahn Khot': {
    title: 'Bánh Khọt',
    description:
      'Bite-sized crisp rice-flour pancakes from southern Vietnam, golden with turmeric and coconut milk and topped with shrimp. Wrap them in lettuce and herbs and dip them in nước chấm.',
  },
  'Zhanzie Noodle Soup': {
    title: 'Beef Noodle Soup',
    description:
      'Wheat noodles in a clear beef broth simmered for hours, topped with sliced braised beef, a soft-boiled egg and scallions.',
  },
  'Egg Stew': {
    title: 'Egg Stew',
    description:
      'Khai palo: boiled eggs and pork belly braised in a dark, gently sweet broth of palm sugar, soy sauce and five-spice, with garlic, coriander root and white pepper. Served with jasmine rice.',
  },
  Ceviche: null,
  Croquetas: null,
  'Nasi Lemak': null,
};

const vietnameseDishes: DishContent[] = [
  {
    title: 'Phở Bò',
    description:
      'Rice noodles in a clear beef broth simmered with star anise, cinnamon, charred onion and ginger, topped with sliced beef and beef balls. Served with bean sprouts, Thai basil, lime and chili.',
    priceCents: 1699,
    images: ['/Menu/Vietnamese/pho.svg'],
  },
  {
    title: 'Chả Giò',
    description:
      'Crisp fried spring rolls filled with pork, shrimp, glass noodles, wood ear mushroom and carrot. Wrap them in lettuce and herbs and dip them in nước chấm.',
    priceCents: 999,
    images: ['/Menu/Vietnamese/roll.svg'],
  },
  {
    title: 'Cơm Gà',
    description:
      'Hội An chicken rice: rice cooked in chicken broth with a little turmeric, topped with shredded chicken and herbs, with a boiled egg, cucumber and a ginger and chili sauce.',
    priceCents: 1599,
    images: ['/Menu/Vietnamese/chicken.svg'],
  },
];

/**
 * Dishes that appear in the design file but not in the original menu. Their photos are added
 * once the image licenses are confirmed; until then the UI shows its placeholder.
 */
const figmaDishes: DishContent[] = [
  {
    title: 'Bibimbap',
    description:
      'Warm rice topped with seasoned vegetables, marinated beef and a fried egg, served with gochujang to mix through at the table.',
    priceCents: 1699,
    images: [],
  },
  {
    title: 'Bulgogi',
    description:
      'Thin slices of beef marinated in soy, pear, garlic and sesame, seared over high heat and served with rice and lettuce wraps.',
    priceCents: 2299,
    images: [],
  },
  {
    title: 'Naengmyeon',
    description:
      'Chewy buckwheat noodles in an icy, tangy beef broth with cucumber, pear and a boiled egg. Best on a hot day.',
    priceCents: 1599,
    images: [],
  },
  {
    title: 'Samgyeopsal',
    description:
      'Thick-cut grilled pork belly with ssamjang, garlic and kimchi, ready to wrap in fresh lettuce leaves.',
    priceCents: 2499,
    images: [],
  },
  {
    title: 'Tteokbokki',
    description:
      'Soft rice cakes and fish cakes simmered in a sweet and spicy gochujang sauce, finished with scallions and sesame.',
    priceCents: 1299,
    images: [],
  },
];

/** Starts sold out, so the sold-out states can be seen and tested on a fresh install. */
const SOLD_OUT = new Set(['naengmyeon']);

const specials = new Map(SpecialOffersContent.map((offer) => [offer.title, offer]));

function dish(content: DishContent, cuisine: Cuisine, isSpecial = false): SeedMenuItem {
  const slug = slugify(content.title);
  return {
    ...content,
    slug,
    cuisine,
    isSpecial,
    isAvailable: !SOLD_OUT.has(slug),
    ...demoStats(slug, cuisine),
  };
}

function fromConstants(
  items: { title: string; price: number; imgSrc: string; description: string }[],
  cuisine: Cuisine,
): SeedMenuItem[] {
  return items.flatMap((item) => {
    const correction = CORRECTIONS[item.title];
    if (correction === null) return [];
    const special = specials.get(item.title);
    return [
      dish(
        {
          title: correction?.title ?? item.title,
          description: correction?.description ?? item.description,
          priceCents: cents(special?.price ?? item.price),
          images: [item.imgSrc],
        },
        cuisine,
        Boolean(special),
      ),
    ];
  });
}

const koreaBbq = SpecialOffersContent.find((offer) => offer.title === 'Korea BBQ');

export const menuItems: SeedMenuItem[] = [
  ...fromConstants(koreanMenu, 'KOREAN'),
  ...fromConstants(VietnameseMenu, 'VIETNAMESE'),
  ...vietnameseDishes.map((content) => dish(content, 'VIETNAMESE')),
  ...fromConstants(ThaiMenu, 'THAI'),
  ...(koreaBbq
    ? [
        dish(
          {
            title: 'Korean BBQ',
            description:
              'A grill platter of marinated short rib, pork belly and chicken with banchan, rice and dipping sauces.',
            priceCents: cents(koreaBbq.price),
            images: [koreaBbq.imageSrc],
          },
          'KOREAN',
          true,
        ),
      ]
    : []),
  ...figmaDishes.map((content) => dish(content, 'KOREAN')),
];
