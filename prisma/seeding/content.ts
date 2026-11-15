import { footerLinks } from '../../constants';
import { type Block, richText } from './rich-text';

const day = 24 * 60 * 60 * 1000;

export const siteSettings = {
  storeName: 'Foodz',
  addressText: '88 Harbor Street, Boston, MA 02210',
  lat: 42.3505,
  lng: -71.045,
  timezone: 'America/New_York',
  deliveryRadiusKm: 8,
  baseDeliveryFeeCents: 199,
  perKmFeeCents: 50,
  taxRateBps: 625,
  openingHours: {
    mon: { open: '11:00', close: '22:00' },
    tue: { open: '11:00', close: '22:00' },
    wed: { open: '11:00', close: '22:00' },
    thu: { open: '11:00', close: '22:00' },
    fri: { open: '11:00', close: '23:00' },
    sat: { open: '12:00', close: '23:00' },
    sun: { open: '12:00', close: '21:00' },
  },
  contactEmail: 'hello@foodz.example',
  contactPhone: '+1 617 555 0142',
  socialLinks: {},
  footerLinks: footerLinks.map((group) => ({
    title: group.title,
    links: group.links.map((link) => ({ label: link.name, href: link.link })),
  })),
  seo: {
    title: 'Foodz: Korean, Thai and Vietnamese food, delivered',
    description:
      'Order Korean, Thai and Vietnamese dishes cooked to order and delivered hot, with live tracking.',
  },
};

// ------------------------------------------------------------------ site pages

const pages: { slug: string; title: string; blocks: Block[] }[] = [
  {
    slug: 'terms',
    title: 'Terms and Conditions',
    blocks: [
      {
        p: 'Foodz is a demonstration store. Orders placed here are not cooked or delivered, and card payments run in test mode only.',
      },
      { h2: 'Using Foodz' },
      {
        p: 'You need an account to order. Keep your password private and tell us straight away if you think someone else has used your account.',
      },
      { h2: 'Orders and prices' },
      {
        p: 'Prices, delivery fees and tax are confirmed at checkout. An order is accepted once the kitchen confirms it; until then we may cancel it, for example if a dish has sold out.',
      },
      { h2: 'Delivery' },
      {
        p: 'We deliver within the radius shown at checkout. Delivery times are estimates. Please be available to receive your order and give the courier the four-digit code shown in the app.',
      },
      { h2: 'Accounts we may suspend' },
      {
        p: 'We may suspend accounts that abuse coupons, harass couriers or staff, or try to interfere with the service.',
      },
      { h2: 'Changes to these terms' },
      {
        p: 'When these terms change we show the date of the update here and ask you to accept the new version the next time you sign in.',
      },
    ],
  },
  {
    slug: 'privacy',
    title: 'Privacy Policy',
    blocks: [
      { h2: 'What we collect' },
      {
        list: [
          'Account details: your name, email address and, if you add it, a phone number.',
          'Delivery details: the addresses you save and the location of each delivery.',
          'Order history, reviews and any requests you send to support.',
        ],
      },
      { h2: 'How we use it' },
      {
        p: 'To take and deliver your orders, keep your account secure, answer support requests and prevent fraud. We do not sell your data.',
      },
      { h2: 'Who sees it' },
      {
        p: 'Couriers see your first name and drop-off address once they accept your order, and your phone number only while the delivery is under way. Card details go straight to our payment processor and never reach our servers.',
      },
      { h2: 'How long we keep it' },
      {
        p: 'Courier location history is deleted 30 days after delivery. Photos sent with refund requests or reports are deleted 180 days after the case closes. Order records are kept for accounting.',
      },
      { h2: 'Your choices' },
      {
        p: 'From your account page you can download a copy of your data or delete your account at any time.',
      },
    ],
  },
  {
    slug: 'refund-policy',
    title: 'Refund Policy',
    blocks: [
      {
        p: 'If something is wrong with an order, open it in your order history and choose "Get help" within 24 hours of delivery.',
      },
      { h2: 'What we can refund' },
      {
        list: [
          'Missing or wrong items',
          'Food that arrived damaged or cold',
          'Deliveries that were very late',
        ],
      },
      { h2: 'How refunds are paid' },
      {
        p: 'Card orders are refunded to the original card, usually within 5 to 10 business days. Cash orders receive store credit as a single-use code.',
      },
      { h2: 'Decisions' },
      {
        p: 'Our support team reviews every request and may approve all or part of it. If a request is declined, we tell you why.',
      },
    ],
  },
  {
    slug: 'faq',
    title: 'Frequently Asked Questions',
    blocks: [
      { h3: 'How long does delivery take?' },
      {
        p: 'Most orders arrive within 45 minutes. You can follow your courier on the map from the moment they pick up your food.',
      },
      { h3: 'Can I pay with cash?' },
      { p: 'Yes. Choose cash at checkout and pay the courier when your order arrives.' },
      { h3: 'How do I use a coupon?' },
      { p: 'Enter the code at checkout. The discount is shown before you pay.' },
      { h3: 'Can I change my order after placing it?' },
      {
        p: 'You can cancel until the kitchen accepts the order. After that, contact support and we will do what we can.',
      },
      { h3: 'Do you cater for allergies?' },
      {
        p: 'Each dish lists its main ingredients. Our kitchen handles nuts, gluten, soy and shellfish, so we cannot guarantee any dish is free of them.',
      },
    ],
  },
  {
    slug: 'about',
    title: 'About Foodz',
    blocks: [
      {
        p: 'Foodz cooks Korean, Thai and Vietnamese favourites to order, from jajangmyeon and kimchi jjigae to pad thai and bánh khọt.',
      },
      {
        p: 'Everything is made in one kitchen and delivered by our own couriers, so we can tell you exactly where your food is.',
      },
      {
        p: 'This site is a demonstration of the full ordering platform: storefront, kitchen and admin tools, and the courier app.',
      },
    ],
  },
];

export const contentPages = pages.map((page) =>
  Object.assign(page, { body: richText(page.blocks) }),
);

// ------------------------------------------------------------------ promotions

export function coupons(now: Date) {
  return [
    {
      code: 'WELCOME10',
      description: '10% off your first order (up to $10)',
      type: 'PERCENT' as const,
      value: 10,
      minSubtotalCents: 1500,
      maxDiscountCents: 1000,
      perUserLimit: 1,
    },
    {
      code: 'FREEDELIVERY',
      description: 'Free delivery on orders over $30',
      type: 'FREE_DELIVERY' as const,
      value: 0,
      minSubtotalCents: 3000,
    },
    {
      code: 'KBBQ5',
      description: '$5 off Korean dishes over $25',
      type: 'FIXED' as const,
      value: 500,
      minSubtotalCents: 2500,
      cuisines: ['KOREAN' as const],
      endsAt: new Date(now.getTime() + 30 * day),
    },
    {
      code: 'SUMMER25',
      description: 'Expired summer offer',
      type: 'PERCENT' as const,
      value: 25,
      startsAt: new Date(now.getTime() - 120 * day),
      endsAt: new Date(now.getTime() - 30 * day),
    },
  ];
}

export function campaigns(now: Date) {
  const starts = new Date(now.getTime() - day);
  const ends = new Date(now.getTime() + 30 * day);
  return [
    {
      key: 'home-korean-bbq',
      title: 'Korean BBQ weekend',
      subtitle: '$5 off Korean dishes over $25 with code KBBQ5',
      ctaLabel: 'Order now',
      ctaHref: '/menu',
      placement: 'HOME_CAROUSEL' as const,
      couponCode: 'KBBQ5',
      priority: 10,
      menuSlugs: ['korean-bbq', 'yangnyeom-chicken', 'bulgogi', 'samgyeopsal'],
      startsAt: starts,
      endsAt: ends,
    },
    {
      key: 'bar-free-delivery',
      title: 'Free delivery on orders over $30',
      subtitle: 'Use code FREEDELIVERY at checkout',
      ctaLabel: null,
      ctaHref: null,
      placement: 'ANNOUNCEMENT_BAR' as const,
      couponCode: 'FREEDELIVERY',
      priority: 5,
      menuSlugs: [],
      startsAt: starts,
      endsAt: ends,
    },
    {
      key: 'menu-specials',
      title: "Today's specials",
      subtitle: 'Our cooks’ picks, at special prices',
      ctaLabel: 'See specials',
      ctaHref: '/menu',
      placement: 'MENU_TOP' as const,
      couponCode: null,
      priority: 1,
      menuSlugs: ['gimbap', 'kimchi', 'korean-bbq'],
      startsAt: starts,
      endsAt: ends,
    },
  ];
}

// ------------------------------------------------------------------ blog

export const tags = [
  { name: 'Korean', slug: 'korean', color: 1 },
  { name: 'Thai', slug: 'thai', color: 6 },
  { name: 'Vietnamese', slug: 'vietnamese', color: 7 },
  { name: 'Recipes', slug: 'recipes', color: 4 },
  { name: 'Behind the kitchen', slug: 'behind-the-kitchen', color: 3 },
];

const posts: {
  slug: string;
  title: string;
  excerpt: string;
  tags: string[];
  featured: boolean;
  daysAgo: number;
  blocks: Block[];
}[] = [
  {
    slug: 'how-we-make-kimchi',
    title: 'How we make our kimchi',
    excerpt:
      'Two days, forty heads of cabbage and a lot of gochugaru: inside our weekly kimchi batch.',
    tags: ['korean', 'behind-the-kitchen'],
    featured: true,
    daysAgo: 3,
    blocks: [
      {
        p: 'Every Monday the kitchen salts forty heads of napa cabbage. By Wednesday the first jars go into the walk-in, and by the weekend they are sour enough for kimchi jjigae.',
      },
      { h2: 'Salt first, then wait' },
      {
        p: 'Salting draws water out of the leaves so they stay crunchy. We rinse three times and leave the cabbage to drain overnight.',
      },
      { h2: 'The paste' },
      {
        list: [
          'Gochugaru (Korean chili flakes)',
          'Garlic, ginger and scallions',
          'Fish sauce and salted shrimp',
          'A little rice porridge to help it all stick',
        ],
      },
      {
        p: 'Young kimchi is fresh and spicy. Older kimchi turns sour and deep, which is exactly what you want in a stew.',
      },
    ],
  },
  {
    slug: 'a-short-guide-to-thai-curries',
    title: 'Green, red or panang? A short guide to Thai curries',
    excerpt:
      'What makes each curry different, and which one to order if you do not like it too hot.',
    tags: ['thai'],
    featured: false,
    daysAgo: 10,
    blocks: [
      {
        p: 'All three start with a paste pounded from chilies, lemongrass, galangal and shallots. The chili decides the rest.',
      },
      { h3: 'Green curry' },
      {
        p: 'Fresh green chilies and Thai basil. Bright, herbal and usually the hottest of the three.',
      },
      { h3: 'Red curry' },
      { p: 'Dried red chilies give a rounder, smokier heat.' },
      { h3: 'Panang' },
      {
        p: 'Thick, rich and a little sweet, with peanuts in the paste. A good place to start if you prefer it mild.',
      },
    ],
  },
  {
    slug: 'banh-khot-at-home',
    title: 'Bánh khọt at home',
    excerpt: 'Crispy coconut rice cakes from southern Vietnam, and the pan you need to make them.',
    tags: ['vietnamese', 'recipes'],
    featured: false,
    daysAgo: 18,
    blocks: [
      {
        p: 'Bánh khọt are bite-sized rice-flour cakes, crisp outside and soft in the middle, each topped with a shrimp.',
      },
      { h2: 'You will need' },
      {
        list: [
          'Rice flour and a spoon of tapioca starch',
          'Coconut milk and turmeric',
          'Small shrimp and scallions',
          'A cast-iron pan with round wells',
        ],
      },
      {
        p: 'Heat the pan until the oil shimmers, fill each well halfway, add a shrimp and cover for two minutes. Serve with lettuce, herbs and nước chấm.',
      },
    ],
  },
];

export function blogPosts(now: Date) {
  return posts.map((post) => ({
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    tags: post.tags,
    featured: post.featured,
    body: richText(post.blocks),
    publishedAt: new Date(now.getTime() - post.daysAgo * day),
  }));
}
