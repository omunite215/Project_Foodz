import { v7 as uuid } from 'uuid';
import type { UserActor } from '@/server/auth/session';
import type { PrismaClient } from '@/server/db/generated/client';

/*
 * Helpers for the F7 suites. Rows are written by the table owner, the way the seed does, so
 * each scenario starts from exactly the state the story describes: partners online at a known
 * distance and wait, and orders already ready.
 */

/** About 111 m per thousandth of a degree of latitude. */
const KM_PER_DEGREE = 111.2;

export async function kitchenPoint(migrator: PrismaClient) {
  const kitchen = await migrator.siteSettings.findUniqueOrThrow({
    where: { id: 1 },
    select: { lat: true, lng: true, deliveryRadiusKm: true },
  });
  return kitchen;
}

/** Nothing from another suite is online, searching or open when a scenario starts. */
export async function quietDispatch(migrator: PrismaClient) {
  await migrator.deliveryOffer.updateMany({
    where: { status: 'PENDING' },
    data: { status: 'WITHDRAWN', endedReason: 'withdrawn-order' },
  });
  await migrator.$executeRaw`
    UPDATE deliveries SET status = 'CANCELLED', partner_id = NULL, assigned_at = NULL
    WHERE status IN ('SEARCHING', 'ASSIGNED', 'AT_RESTAURANT', 'PICKED_UP')`;
  await migrator.$executeRaw`
    UPDATE delivery_partners
    SET is_online = false, online_since = NULL, online_session_id = NULL, last_location = NULL,
        offline_reason = 'self', offline_at = now()
    WHERE is_online`;
}

export interface TestPartner {
  partnerId: string;
  userId: string;
  name: string;
  actor: UserActor;
}

/** An approved partner (offline until `goOnlineAt`). */
export async function approvedPartner(
  migrator: PrismaClient,
  name: string,
  options: { demo?: boolean; vehicle?: 'BICYCLE' | 'SCOOTER' | 'CAR'; plate?: string | null } = {},
): Promise<TestPartner> {
  const userId = uuid();
  await migrator.user.create({
    data: {
      id: userId,
      name,
      email: `partner-${userId}@test.dev`,
      role: 'partner',
      phone: '+16175550199',
      isDemo: options.demo ?? false,
      emailVerified: true,
    },
  });
  const partner = await migrator.deliveryPartner.create({
    data: {
      userId,
      status: 'APPROVED',
      vehicleType: options.vehicle ?? 'SCOOTER',
      vehiclePlate: options.plate === undefined ? '7KT 342' : options.plate,
      approvedAt: new Date(),
      welcomedAt: new Date(),
      version: 2,
    },
    select: { id: true },
  });
  return {
    partnerId: partner.id,
    userId,
    name,
    actor: { kind: 'user', userId, role: 'partner', isDemo: options.demo ?? false },
  };
}

/**
 * Online `km` north of the kitchen, waiting since `waitingMinutes` ago, with a point
 * `pointSecondsAgo` old (the trigger stamps the wait; the second write sets the story's values).
 */
export async function goOnlineAt(
  migrator: PrismaClient,
  partner: TestPartner,
  options: { km: number; waitingMinutes?: number; pointSecondsAgo?: number; unseenInRow?: number },
) {
  const kitchen = await kitchenPoint(migrator);
  const lat = kitchen.lat + options.km / KM_PER_DEGREE;
  await migrator.$executeRaw`
    UPDATE delivery_partners
    SET is_online = true, online_since = now(), online_session_id = ${uuid()}::uuid,
        offline_reason = NULL, offline_at = NULL, last_seen_at = now(),
        last_location = ST_SetSRID(ST_MakePoint(${kitchen.lng}, ${lat}), 4326)::geography
    WHERE id = ${partner.partnerId}::uuid`;
  await migrator.$executeRaw`
    UPDATE delivery_partners
    SET waiting_since = app_now() - make_interval(mins => ${options.waitingMinutes ?? 5}),
        last_point_at = app_now() - make_interval(secs => ${options.pointSecondsAgo ?? 5}),
        unseen_in_row = ${options.unseenInRow ?? 0}
    WHERE id = ${partner.partnerId}::uuid`;
}

export async function customerAccount(migrator: PrismaClient, name: string, demo = false) {
  const userId = uuid();
  await migrator.user.create({
    data: { id: userId, name, email: `customer-${userId}@test.dev`, isDemo: demo },
  });
  const actor: UserActor = { kind: 'user', userId, role: 'customer', isDemo: demo };
  return { userId, actor };
}

let counter = 0;

/** A ready order, `readyMinutes` ago: $2.64 delivery fee and a $5 tip unless told otherwise. */
export async function readyOrder(
  migrator: PrismaClient,
  userId: string,
  options: { readyMinutes?: number; cash?: boolean; tipCents?: number } = {},
) {
  counter += 1;
  const order = await migrator.order.create({
    data: {
      number: `T7-${Date.now()}-${counter}`,
      userId,
      status: 'READY',
      paymentMethod: options.cash === false ? 'CARD' : 'CASH',
      contactName: 'Priya Shah',
      contactPhone: '+16175550101',
      addressText: '1 Faneuil Hall Square, Boston, MA 02109',
      addressLine1: '1 Faneuil Hall Square',
      addressCity: 'Boston, MA 02109',
      addressLat: 42.3601,
      addressLng: -71.0549,
      distanceKm: 1.3,
      subtotalCents: 4800,
      deliveryFeeCents: 264,
      taxCents: 333,
      tipCents: options.tipCents ?? 500,
      totalCents: 5897,
      readyAt: new Date(Date.now() - (options.readyMinutes ?? 1) * 60_000),
    },
    select: { id: true, number: true },
  });
  return order;
}
