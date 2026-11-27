import { v5 as uuidv5 } from 'uuid';
import type { Prisma, PrismaClient } from '../../server/db/generated/client';
import { clearEarningsForOrders } from './earnings';

/*
 * The staff order board's fixtures (F5 story "Board fixtures"): S1101 to S1108, placed relative
 * to the moment they are seeded, in every board state, with the timeline each state implies.
 * Local and CI databases only, beside the sample accounts. `npm run seed:board` puts them back
 * as they were, because their timers age; it never touches another order.
 */

export type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

const NAMESPACE = '8c1d7a52-5b1e-4f0e-9a37-2f4b9d0c6e11';
const seedId = (name: string) => uuidv5(name, NAMESPACE);

export const BOARD_FIXTURE_NUMBERS = [
  'S1101',
  'S1102',
  'S1103',
  'S1104',
  'S1105',
  'S1106',
  'S1107',
  'S1108',
] as const;
export type BoardFixtureNumber = (typeof BOARD_FIXTURE_NUMBERS)[number];

export const boardFixtureId = (number: BoardFixtureNumber) => seedId(`board:${number}`);

export interface BoardPeople {
  /** Priya Shah, second.customer@foodz.example (sample). */
  priya: string;
  /** Dana, demo.customer@foodz.example (demo). */
  dana: string;
  /** Alex Kim, kitchen@foodz.example (sample). */
  alex: string;
  /** Morgan Diaz, support@foodz.example (sample). */
  morgan: string;
}

const MINUTE_MS = 60_000;
const TAX_BPS = 700;
const ALEX = { name: 'Alex Kim', role: 'kitchen' } as const;
const MORGAN = { name: 'Morgan Diaz', role: 'support' } as const;

interface Customer {
  key: 'priya' | 'dana';
  name: string;
  phone: string;
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  instructions: string | null;
  lat: number;
  lng: number;
  distanceKm: number;
}

const PRIYA: Customer = {
  key: 'priya',
  name: 'Priya Shah',
  phone: '+16175550123',
  label: 'Work',
  line1: '1 Faneuil Hall Square',
  line2: null,
  city: 'Boston, MA 02109',
  instructions: 'Front desk takes deliveries',
  lat: 42.36,
  lng: -71.0548,
  distanceKm: 1.3,
};

const DANA: Customer = {
  key: 'dana',
  name: 'Dana Customer',
  phone: '+16175550199',
  label: 'Home',
  line1: '12 Peterborough Street',
  line2: 'Apt 3',
  city: 'Boston, MA 02215',
  instructions: 'Buzzer 3, leave at the door',
  lat: 42.3467,
  lng: -71.0972,
  distanceKm: 4.3,
};

interface Line {
  slug: string;
  quantity: number;
  flavors?: string[];
  note?: string;
}

/** A kitchen step and when it happened, in minutes from the seed's moment. */
type Step = 'accepted' | 'preparing' | 'ready';

interface Fixture {
  number: BoardFixtureNumber;
  customer: Customer;
  status: 'PLACED' | 'ACCEPTED' | 'PREPARING' | 'READY' | 'CANCELLED';
  placed: number;
  steps: Partial<Record<Step, number>>;
  lines: Line[];
  card: boolean;
  note?: string;
  cancelled?: { at: number; code: 'customer-asked'; note: string };
}

const FIXTURES: Fixture[] = [
  {
    number: 'S1101',
    customer: PRIYA,
    status: 'PLACED',
    placed: -1,
    steps: {},
    lines: [
      { slug: 'gimbap', quantity: 2, flavors: ['Gochujang'] },
      { slug: 'pad-thai', quantity: 1 },
    ],
    card: true,
    note: 'More spicy, more sauce',
  },
  {
    number: 'S1102',
    customer: DANA,
    status: 'PLACED',
    placed: -6,
    steps: {},
    lines: [{ slug: 'bulgogi', quantity: 1 }],
    card: false,
  },
  {
    number: 'S1103',
    customer: PRIYA,
    status: 'ACCEPTED',
    placed: -4,
    steps: { accepted: -3 },
    lines: [{ slug: 'kimchi', quantity: 5, note: 'No sesame please' }],
    card: false,
  },
  {
    number: 'S1104',
    customer: DANA,
    status: 'PREPARING',
    placed: -17,
    steps: { accepted: -16, preparing: -15 },
    lines: [
      { slug: 'pho-bo', quantity: 1 },
      { slug: 'cha-gio', quantity: 2 },
    ],
    card: false,
  },
  {
    number: 'S1105',
    customer: PRIYA,
    status: 'PREPARING',
    placed: -30,
    steps: { accepted: -28, preparing: -25 },
    lines: [{ slug: 'green-curry', quantity: 1 }],
    card: true,
    note: '<b>extra rice</b>',
  },
  {
    number: 'S1106',
    customer: DANA,
    status: 'READY',
    placed: -22,
    steps: { accepted: -21, preparing: -20, ready: -4 },
    lines: [{ slug: 'fried-thai-rice', quantity: 1 }],
    card: false,
  },
  {
    number: 'S1107',
    customer: PRIYA,
    status: 'READY',
    placed: -40,
    steps: { accepted: -39, preparing: -38, ready: -16 },
    lines: [{ slug: 'samgyeopsal', quantity: 2 }],
    card: true,
  },
  {
    number: 'S1108',
    customer: PRIYA,
    status: 'CANCELLED',
    placed: -50,
    steps: {},
    lines: [{ slug: 'tteokbokki', quantity: 1 }],
    card: false,
    cancelled: { at: -45, code: 'customer-asked', note: 'Called back to confirm' },
  },
];

/** F4 B15: longest prep + 10 minutes + 3 minutes a km, rounded up to 5, ten minutes wide. */
function arrivalWindow(prepMinutes: number, distanceKm: number) {
  const travel = Math.ceil((3 * Math.round(distanceKm * 10)) / 10);
  const from = Math.ceil((prepMinutes + 10 + travel) / 5) * 5;
  return { from, to: from + 10 };
}

/** The delivery fee as F3 prices it: $1.99 plus $0.50 a km, by tenths. */
const deliveryFee = (distanceKm: number) =>
  199 + Math.round((50 * Math.round(distanceKm * 10)) / 10);

const STEP_STATUS: Record<Step, 'ACCEPTED' | 'PREPARING' | 'READY'> = {
  accepted: 'ACCEPTED',
  preparing: 'PREPARING',
  ready: 'READY',
};
const STEP_FROM: Record<Step, 'PLACED' | 'ACCEPTED' | 'PREPARING'> = {
  accepted: 'PLACED',
  preparing: 'ACCEPTED',
  ready: 'PREPARING',
};

/**
 * Puts S1101 to S1108 back as the story describes them, `now` being T. Their earlier rows
 * (lines, timeline, code uses) go with them. Returns how many did not exist before.
 */
export async function resetBoardFixtures(tx: Tx, people: BoardPeople, now: Date): Promise<number> {
  const at = (minutes: number) => new Date(now.getTime() + minutes * MINUTE_MS);
  const ids = BOARD_FIXTURE_NUMBERS.map(boardFixtureId);
  const existing = await tx.order.count({ where: { id: { in: ids } } });
  // F9: the ledger keeps a delivery (RESTRICT), so the ledgers of whoever has entries on the
  // fixtures go first.
  const fixtureOrders = await tx.order.findMany({
    where: { OR: [{ id: { in: ids } }, { number: { in: [...BOARD_FIXTURE_NUMBERS] } }] },
    select: { id: true },
  });
  await clearEarningsForOrders(
    tx,
    fixtureOrders.map((order) => order.id),
  );
  await tx.order.deleteMany({
    where: { OR: [{ id: { in: ids } }, { number: { in: [...BOARD_FIXTURE_NUMBERS] } }] },
  });

  const dishes = new Map(
    (
      await tx.menuItem.findMany({
        where: {
          slug: { in: FIXTURES.flatMap((fixture) => fixture.lines.map((line) => line.slug)) },
        },
        select: { id: true, slug: true, title: true, priceCents: true, prepMinutes: true },
      })
    ).map((dish) => [dish.slug, dish]),
  );

  for (const fixture of FIXTURES) {
    const id = boardFixtureId(fixture.number);
    const customer = fixture.customer;
    const lines = fixture.lines.map((line) => {
      const dish = dishes.get(line.slug);
      if (!dish) throw new Error(`The menu has no ${line.slug}; seed the catalog first.`);
      return { ...line, dish };
    });
    const prep = Math.max(...lines.map((line) => line.dish.prepMinutes));
    const subtotal = lines.reduce((sum, line) => sum + line.dish.priceCents * line.quantity, 0);
    const fee = deliveryFee(customer.distanceKm);
    const tax = Math.round((subtotal * TAX_BPS) / 10_000);
    const window = arrivalWindow(prep, customer.distanceKm);
    const placedAt = at(fixture.placed);
    const steps = (['accepted', 'preparing', 'ready'] as const).filter(
      (step) => fixture.steps[step] !== undefined,
    );
    const userId = people[customer.key];

    // One version per status change after it was placed: the board's conflict check reads it.
    const version = 1 + steps.length + (fixture.cancelled ? 1 : 0);
    await tx.order.create({
      data: {
        id,
        number: fixture.number,
        userId,
        status: fixture.status,
        paymentMethod: fixture.card ? 'CARD' : 'CASH',
        paymentStatus: fixture.card ? 'PAID' : 'UNPAID',
        contactName: customer.name,
        contactPhone: customer.phone,
        addressText: [customer.line1, customer.line2, customer.city].filter(Boolean).join(', '),
        addressLabel: customer.label,
        addressLine1: customer.line1,
        addressLine2: customer.line2,
        addressCity: customer.city,
        courierInstructions: customer.instructions,
        addressLat: customer.lat,
        addressLng: customer.lng,
        distanceKm: customer.distanceKm,
        note: fixture.note ?? null,
        subtotalCents: subtotal,
        deliveryFeeCents: fee,
        taxCents: tax,
        taxRateBps: TAX_BPS,
        tipCents: 0,
        tipChoice: 'none',
        totalCents: subtotal + fee + tax,
        // Seeded card orders carry no Stripe payment (B13): cancelling one refunds nothing.
        ...(fixture.card && { cardBrand: 'visa', cardLast4: '4242' }),
        arrivalFromMinutes: window.from,
        arrivalToMinutes: window.to,
        prepMinutes: prep,
        placedAt,
        acceptedAt: fixture.steps.accepted === undefined ? null : at(fixture.steps.accepted),
        preparingAt: fixture.steps.preparing === undefined ? null : at(fixture.steps.preparing),
        readyAt: fixture.steps.ready === undefined ? null : at(fixture.steps.ready),
        ...(fixture.cancelled && {
          cancelledAt: at(fixture.cancelled.at),
          cancelReason: 'staff',
          cancelCode: fixture.cancelled.code,
        }),
        version,
        createdAt: fixture.card ? new Date(placedAt.getTime() - 30_000) : placedAt,
        items: {
          create: lines.map((line) => ({
            menuItemId: line.dish.id,
            title: line.dish.title,
            unitPriceCents: line.dish.priceCents,
            quantity: line.quantity,
            flavors: line.flavors ?? [],
            note: line.note ?? null,
          })),
        },
      },
      select: { id: true },
    });

    const events: Prisma.OrderEventCreateManyInput[] = [];
    if (fixture.card) {
      events.push(
        {
          orderId: id,
          type: 'created',
          toStatus: 'PENDING_PAYMENT',
          actorId: userId,
          data: { actor: 'customer', method: 'card' },
          createdAt: new Date(placedAt.getTime() - 30_000),
        },
        {
          orderId: id,
          type: 'paid',
          data: { actor: 'stripe', amountCents: subtotal + fee + tax },
          createdAt: placedAt,
        },
        {
          orderId: id,
          type: 'placed',
          fromStatus: 'PENDING_PAYMENT',
          toStatus: 'PLACED',
          data: { actor: 'stripe', method: 'card' },
          createdAt: new Date(placedAt.getTime() + 1),
        },
      );
    } else {
      events.push(
        {
          orderId: id,
          type: 'created',
          toStatus: 'PLACED',
          actorId: userId,
          data: { actor: 'customer', method: 'cash' },
          createdAt: placedAt,
        },
        {
          orderId: id,
          type: 'placed',
          toStatus: 'PLACED',
          actorId: userId,
          data: { actor: 'customer', method: 'cash' },
          createdAt: new Date(placedAt.getTime() + 1),
        },
      );
    }
    steps.forEach((step, index) => {
      const minutes = fixture.steps[step] ?? 0;
      // Against ready-by (placed plus the longest prep): negative is early.
      const readyLate = step === 'ready' ? minutes - (fixture.placed + prep) : undefined;
      events.push({
        orderId: id,
        type: step,
        fromStatus: STEP_FROM[step],
        toStatus: STEP_STATUS[step],
        actorId: people.alex,
        data: {
          by: ALEX,
          versionAfter: 2 + index,
          ...(readyLate !== undefined && { lateMinutes: readyLate }),
        },
        createdAt: at(minutes),
      });
    });
    if (fixture.cancelled) {
      events.push({
        orderId: id,
        type: 'cancelled',
        fromStatus: 'PLACED',
        toStatus: 'CANCELLED',
        actorId: people.morgan,
        data: {
          actor: 'staff',
          by: MORGAN,
          reason: fixture.cancelled.code,
          lineIds: [],
          dishes: [],
          note: fixture.cancelled.note,
          refundCents: 0,
          refundAnnounced: false,
          sample: false,
          codeReleased: null,
        },
        createdAt: at(fixture.cancelled.at),
      });
    }
    await tx.orderEvent.createMany({ data: events });
  }
  return BOARD_FIXTURE_NUMBERS.length - existing;
}
