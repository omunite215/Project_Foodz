import { v7 as uuid } from 'uuid';
import { expect } from 'vitest';
import type { PrismaClient } from '@/server/db/generated/client';
import * as addresses from '@/server/modules/addresses/actions';
import * as authActions from '@/server/modules/auth/actions';
import type { PlaceOrderInput } from '@/server/modules/orders/schema';
import { siteSettings } from '../../../prisma/seeding/content';
import { type Browser, newBrowser, switchBrowser } from './browser';

/*
 * Shared steps for the F4 suites. Each test file declares its own mocks (next/headers, the job
 * client, realtime, email), then uses these to make customers and carts.
 */

export const PASSWORD = 'correct horse battery';

export const PLACES = {
  /** Priya's Work: 1.3 km, delivery $2.64. */
  faneuil: {
    kind: 'WORK' as const,
    line1: '1 Faneuil Hall Square',
    line2: 'Apt 4',
    city: 'Boston, MA 02109',
    notes: 'Buzzer 3, leave at the door',
    lat: 42.36,
    lng: -71.0548,
  },
  /** Dana's Home: 4.3 km, delivery $4.14. */
  peterborough: {
    kind: 'HOME' as const,
    line1: '12 Peterborough Street',
    city: 'Boston, MA 02215',
    lat: 42.3467,
    lng: -71.0972,
  },
  /** Quincy Center: about 11.5 km, outside the area. */
  quincy: { line1: '1 Quincy Center', city: 'Quincy, MA 02169', lat: 42.2513, lng: -71.0042 },
};

const ALL_DAY = { open: '00:00', close: '00:00' };

export async function openAllDay(migrator: PrismaClient) {
  await migrator.siteSettings.update({
    where: { id: 1 },
    data: {
      openingHours: {
        mon: ALL_DAY,
        tue: ALL_DAY,
        wed: ALL_DAY,
        thu: ALL_DAY,
        fri: ALL_DAY,
        sat: ALL_DAY,
        sun: ALL_DAY,
      },
    },
  });
}

export async function closeAllWeek(migrator: PrismaClient) {
  await migrator.siteSettings.update({ where: { id: 1 }, data: { openingHours: {} } });
}

export async function restoreHours(migrator: PrismaClient) {
  await migrator.siteSettings.update({
    where: { id: 1 },
    data: { openingHours: siteSettings.openingHours },
  });
}

export interface Customer {
  browser: Browser;
  userId: string;
  email: string;
  addressId: string;
}

/** A confirmed customer signed in on their own browser, with Priya's Work as the default. */
export async function customer(
  migrator: PrismaClient,
  options: { tag?: string; confirmed?: boolean; place?: keyof typeof PLACES } = {},
): Promise<Customer> {
  const browser = switchBrowser(newBrowser());
  const email = `${options.tag ?? 'maya'}-${uuid()}@example.com`;
  const result = await authActions.signUpAction({
    name: 'Maya Lopez',
    email,
    password: PASSWORD,
    captchaToken: 'ok',
  });
  expect(result?.data?.signedIn).toBe(true);
  const { id: userId } = await migrator.user.update({
    where: { email },
    data: { emailVerified: options.confirmed ?? true },
    select: { id: true },
  });
  const place = options.place ?? 'faneuil';
  let addressId: string;
  if (place === 'quincy') {
    const row = await migrator.address.create({
      data: { userId, kind: 'OTHER', label: 'Quincy', ...PLACES.quincy, isDefault: true },
      select: { id: true },
    });
    addressId = row.id;
  } else {
    const saved = await addresses.createAddressAction(PLACES[place]);
    expect(saved?.serverError).toBeUndefined();
    addressId = saved.data!.id;
  }
  return { browser, userId, email, addressId };
}

export async function dishIds(migrator: PrismaClient) {
  const rows = await migrator.menuItem.findMany({ select: { id: true, slug: true } });
  return Object.fromEntries(rows.map((row) => [row.slug, row.id])) as Record<string, string>;
}

let keys = 0;

export const line = (
  dishes: Record<string, string>,
  slug: string,
  quantity = 1,
  extra: Record<string, unknown> = {},
) => ({ key: `line-${(keys += 1)}`, menuItemId: dishes[slug]!, quantity, ...extra });

/** Cart A: 2 × Gimbap + 1 × Pad Thai ($47.97). */
export const cartA = (dishes: Record<string, string>) => [
  line(dishes, 'gimbap', 2),
  line(dishes, 'pad-thai'),
];

export const attemptKey = () => `attempt-${uuid()}`;

/** A press at checkout for this customer; T1 (cart A, cash, no tip) unless told otherwise. */
export function press(
  who: Customer,
  dishes: Record<string, string>,
  extra: Partial<PlaceOrderInput> = {},
): PlaceOrderInput {
  return {
    attemptKey: attemptKey(),
    lines: cartA(dishes),
    addressId: who.addressId,
    tip: { kind: 'none' },
    method: 'cash',
    contactName: 'Maya Lopez',
    phone: '(617) 555-0123',
    expectedTotalCents: 5397,
    ...extra,
  };
}
