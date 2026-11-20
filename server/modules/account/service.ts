import 'server-only';
import { verifyPassword } from 'better-auth/crypto';
import { displayPhone, parsePhone } from '@/lib/phone';
import { can, isRole, isStaff } from '@/server/auth/roles';
import type { UserActor } from '@/server/auth/session';
import { runAs } from '@/server/db/context';
import {
  AppError,
  conflict,
  demoReadOnly,
  forbidden,
  invalidInput,
  reauthRequired,
} from '@/server/errors';
import { countMyAddresses, listMyAddresses } from '@/server/modules/addresses/service';
import { audit } from '@/server/modules/audit/service';
import { logger } from '@/server/logger';
import { countMyFavorites, listMyFavoritesForExport } from '@/server/modules/favorites/service';
import { queueAccountEmail } from '@/server/modules/notifications/account-email';
import {
  anonymizeMyOrders,
  cancelUnpaidOrdersForDeletion,
  countMyOrders,
  exportMyOrders,
  ordersBlockingDeletion,
} from '@/server/modules/orders/service';
import {
  countSavedCards,
  deleteStripeCustomer,
  exportSavedCards,
} from '@/server/modules/payments/service';
import { describeDevice } from './devices';
import {
  anonymizeAccount,
  countDeliveriesInProgress,
  countSessions,
  deleteOtherSessions,
  deleteSession,
  findPasswordHash,
  findPersonForStaff,
  findProfile,
  findSignInMethods,
  listSessions,
  updateProfile as saveProfile,
} from './repo';
import {
  type AccountDto,
  type AccountExport,
  deleteAccountInput,
  type DeviceDto,
  deviceIdInput,
  firstNameOf,
  type SignInMethod,
  type StaffPersonView,
  updateProfileInput,
} from './schema';

/** The session the request is made with: its id and when it signed in. */
export interface CurrentSession {
  id: string;
  createdAt: Date;
}

/** Sensitive changes need a sign-in within this window (S5.11, Decision 14). */
export const FRESH_SESSION_MS = 10 * 60 * 1000;

const DEMO_CANNOT_DELETE =
  "The demo account can't be deleted. Create your own account to try this.";
const STAFF_CANNOT_DELETE = 'Staff accounts are removed by an admin.';
const ORDER_ON_ITS_WAY =
  "You have an order on its way. You can delete your account once it's delivered.";
const orderWaiting = (number: string) =>
  `Order ${number} is waiting for the kitchen. Cancel it from its page, then you can delete your account.`;
const CARDS_NOT_REMOVED =
  "We couldn't remove your saved cards right now, so your account is still here. Try again in a minute.";

/** Whether Google sign-in is configured; the button and divider only show when it is (S1.10). */
export function getAuthOptions(): { google: boolean } {
  return { google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) };
}

// ------------------------------------------------------------------ profile

export async function getMyAccount(actor: UserActor): Promise<AccountDto> {
  const [summary, addressCount] = await Promise.all([
    runAs(actor, async (ctx) => {
      const profile = await findProfile(ctx, actor.userId);
      if (!profile) throw new AppError('UNAUTHENTICATED', 'Please sign in to continue.', 401);
      const methods = await findSignInMethods(ctx, actor.userId);
      const sessions = actor.isDemo ? 1 : await countSessions(ctx, actor.userId, new Date());
      return { profile, methods, sessions };
    }),
    countMyAddresses(actor),
  ]);
  // After the others, so a page render never holds more than two connections at once.
  const favoriteCount = await countMyFavorites(actor);
  const orderCount = await countMyOrders(actor);
  const savedCardCount = await countSavedCards(actor);
  const { profile, methods, sessions } = summary;
  const role = isRole(profile.role) ? profile.role : 'customer';
  const phone = profile.phone ? displayPhone(profile.phone) : null;
  const signInMethods: SignInMethod[] = [
    ...(methods.hasPassword ? (['password'] as const) : []),
    ...(methods.providers.includes('google') ? (['google'] as const) : []),
  ];
  const deleteBlockedReason = profile.isDemo ? 'demo' : isStaff(role) ? 'staff' : null;

  return {
    id: profile.id,
    name: profile.name,
    firstName: firstNameOf(profile.name),
    email: profile.email,
    // The shared demo accounts always show as confirmed (S5.13).
    emailVerified: profile.emailVerified || profile.isDemo,
    phone: profile.phone,
    phoneCountry: phone?.country ?? null,
    phoneDisplay: phone?.display ?? null,
    role,
    isDemo: profile.isDemo,
    isStaff: isStaff(role),
    twoFactorEnabled: Boolean(profile.twoFactorEnabled),
    hasPassword: methods.hasPassword,
    googleLinked: methods.providers.includes('google'),
    signInMethods,
    addressCount,
    favoriteCount,
    orderCount,
    savedCardCount,
    deviceCount: sessions,
    createdAt: profile.createdAt.toISOString(),
    termsAcceptedVersion: profile.termsAcceptedVersion,
    canEditProfile: !profile.isDemo,
    canDelete: deleteBlockedReason === null && can(role, { account: ['delete-own'] }),
    deleteBlockedReason,
  };
}

export async function updateProfile(actor: UserActor, input: unknown): Promise<AccountDto> {
  if (actor.isDemo) throw demoReadOnly("The demo account's profile can't be changed.");
  if (!can(actor.role, { account: ['update-own'] })) throw forbidden();
  const { name, phone, phoneCountry } = updateProfileInput.parse(input);

  const parsedPhone = phone ? parsePhone(phone, phoneCountry) : null;
  if (phone && !parsedPhone) {
    throw invalidInput('Check the highlighted fields.', {
      phone: ['Enter a number we can call, like (617) 555-0142.'],
    });
  }
  await runAs(actor, (ctx) =>
    saveProfile(ctx, actor.userId, { name, phone: parsedPhone?.e164 ?? null }),
  );
  return getMyAccount(actor);
}

// ------------------------------------------------------------------ devices

export async function listDevices(actor: UserActor, current: CurrentSession): Promise<DeviceDto[]> {
  const sessions = await runAs(actor, (ctx) => listSessions(ctx, actor.userId, new Date()));
  // Shared demo accounts see only this device: other visitors' sessions never leave (B6).
  const visible = actor.isDemo ? sessions.filter((s) => s.id === current.id) : sessions;
  return visible
    .map((session) => {
      const device = describeDevice(session.userAgent);
      return {
        id: session.id,
        label: device.label,
        browser: device.browser,
        system: device.system,
        type: device.type,
        isCurrent: session.id === current.id,
        signedInAt: session.createdAt.toISOString(),
        lastActiveAt: session.updatedAt.toISOString(),
      };
    })
    .toSorted((a, b) => Number(b.isCurrent) - Number(a.isCurrent));
}

export async function signOutDevice(
  actor: UserActor,
  input: unknown,
  current: CurrentSession,
): Promise<{ id: string }> {
  if (actor.isDemo) throw demoReadOnly();
  const { id } = deviceIdInput.parse(input);
  if (id === current.id) throw conflict('Use Sign out to sign out of this device.');
  return runAs(actor, async (ctx) => {
    if ((await deleteSession(ctx, actor.userId, id)) === 0) {
      throw new AppError('NOT_FOUND', 'That device is no longer signed in.', 404);
    }
    await audit(ctx, { action: 'account.device-signed-out', targetType: 'session', targetId: id });
    return { id };
  });
}

export async function signOutOtherDevices(
  actor: UserActor,
  current: CurrentSession,
): Promise<{ signedOut: number }> {
  if (actor.isDemo) throw demoReadOnly();
  return runAs(actor, async (ctx) => {
    const signedOut = await deleteOtherSessions(ctx, actor.userId, current.id);
    await audit(ctx, {
      action: 'account.other-devices-signed-out',
      targetType: 'user',
      targetId: actor.userId,
      data: { count: signedOut },
    });
    return { signedOut };
  });
}

// ------------------------------------------------------------------ export (S6.1 to S6.3)

const KIND_NAMES = { HOME: 'Home', WORK: 'Work', OTHER: 'Other' } as const;

export async function exportMyData(
  actor: UserActor,
  current: CurrentSession,
  now = new Date(),
): Promise<{ fileName: string; data: AccountExport }> {
  if (!can(actor.role, { account: ['export-own'] })) throw forbidden();
  const [profile, addresses, devices] = await Promise.all([
    runAs(actor, (ctx) => findProfile(ctx, actor.userId)),
    listMyAddresses(actor),
    listDevices(actor, current),
  ]);
  const favorites = await listMyFavoritesForExport(actor);
  const orders = await exportMyOrders(actor);
  const savedCards = await exportSavedCards(actor);
  if (!profile) throw new AppError('UNAUTHENTICATED', 'Please sign in to continue.', 401);

  const data: AccountExport = {
    about: {
      description:
        'A copy of the personal data Foodz holds about you, made at your request from your account page. Dates are in UTC (ISO 8601). Passwords, security codes and sign-in tokens are never included.',
      generatedAt: now.toISOString(),
      format: 'foodz-data-export',
      version: 1,
    },
    profile: {
      name: profile.name,
      email: profile.email,
      emailConfirmed: profile.emailVerified || profile.isDemo,
      phone: profile.phone,
      joinedAt: profile.createdAt.toISOString(),
      termsVersionAccepted: profile.termsAcceptedVersion,
    },
    addresses: addresses.map((address) => ({
      type: KIND_NAMES[address.kind],
      label: address.label,
      address: address.line1,
      apartment: address.line2,
      city: address.city,
      instructions: address.notes,
      isDefault: address.isDefault,
      savedAt: address.createdAt.toISOString(),
    })),
    devices: devices.map((device) => ({
      device: device.label,
      signedInAt: device.signedInAt,
      lastActiveAt: device.lastActiveAt,
      thisDevice: device.isCurrent,
    })),
    favorites,
    orders,
    savedCards,
  };

  await runAs(actor, (ctx) =>
    audit(ctx, { action: 'account.data-exported', targetType: 'user', targetId: actor.userId }),
  );
  return { fileName: `foodz-data-${now.toISOString().slice(0, 10)}.json`, data };
}

// ------------------------------------------------------------------ deletion (S6.4 to S6.7, B10)

export async function deleteAccount(
  actor: UserActor,
  input: unknown,
  current: CurrentSession,
  now = new Date(),
): Promise<{ deleted: true }> {
  if (actor.isDemo) throw demoReadOnly(DEMO_CANNOT_DELETE);
  if (isStaff(actor.role) || !can(actor.role, { account: ['delete-own'] })) {
    throw forbidden(STAFF_CANNOT_DELETE);
  }
  const { password } = deleteAccountInput.parse(input);

  const { hash, methods } = await runAs(actor, async (ctx) => ({
    hash: await findPasswordHash(ctx, actor.userId),
    methods: await findSignInMethods(ctx, actor.userId),
  }));

  const fresh = now.getTime() - current.createdAt.getTime() <= FRESH_SESSION_MS;
  if (!fresh) {
    if (!password || !hash) {
      throw reauthRequired({
        methods: [
          ...(methods.hasPassword ? ['password'] : []),
          ...(methods.providers.includes('google') ? ['google'] : []),
        ],
      });
    }
    if (!(await verifyPassword({ hash, password }))) {
      throw invalidInput('Check the highlighted fields.', {
        password: ["That password isn't right. Try again."],
      });
    }
  }

  // B21: unpaid card orders are cancelled first, with their payments at Stripe. One Stripe was
  // already paid for becomes placed, and then waits to be cancelled like any placed order (U6).
  await cancelUnpaidOrdersForDeletion(actor, now);
  const blocking = await runAs(actor, (ctx) => ordersBlockingDeletion(ctx, actor.userId));
  if (blocking.onItsWay > 0) throw conflict(ORDER_ON_ITS_WAY);
  if (blocking.placed) {
    throw new AppError('CONFLICT', orderWaiting(blocking.placed.number), 409, {
      details: { orderId: blocking.placed.id, number: blocking.placed.number },
    });
  }
  // Saved cards go with the Stripe customer, before anything here is erased.
  try {
    await deleteStripeCustomer(actor.userId);
  } catch (error) {
    logger.warn({ err: error }, 'could not delete the Stripe customer');
    throw new AppError('UNAVAILABLE', CARDS_NOT_REMOVED, 503);
  }

  const person = await runAs(actor, async (ctx) => {
    const again = await ordersBlockingDeletion(ctx, actor.userId);
    if (again.onItsWay > 0 || (await countDeliveriesInProgress(ctx, actor.userId)) > 0) {
      throw conflict(ORDER_ON_ITS_WAY);
    }
    if (again.placed) throw conflict(orderWaiting(again.placed.number));
    const profile = await findProfile(ctx, actor.userId);
    if (!profile) throw new AppError('UNAUTHENTICATED', 'Please sign in to continue.', 401);
    await anonymizeMyOrders(ctx);
    await anonymizeAccount(ctx, actor.userId, now);
    await audit(ctx, { action: 'account.deleted', targetType: 'user', targetId: actor.userId });
    return {
      email: profile.email,
      // Greeted by name only when the address was confirmed (the name may be a stranger's).
      name: profile.emailVerified ? profile.name : undefined,
    };
  });

  // Addressed before the details were erased; sent once the deletion is committed.
  await queueAccountEmail({ kind: 'account-deleted', to: person.email, name: person.name });
  return { deleted: true };
}

// ------------------------------------------------------------------ staff (U4)

/**
 * A person as staff see them (F11 screens). For a demo staff login the database masks a real
 * person's name, email and phone; demo accounts and seeded sample people are shown in full.
 */
export async function getPersonForStaff(
  actor: UserActor,
  userId: string,
): Promise<StaffPersonView | null> {
  if (!can(actor.role, { user: ['get'] })) throw forbidden();
  const id = deviceIdInput.safeParse({ id: userId });
  if (!id.success) return null;
  const row = await runAs(actor, (ctx) => findPersonForStaff(ctx, id.data.id));
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    isDemo: row.is_demo,
    isSample: row.is_sample,
    emailVerified: row.email_verified,
    banned: row.banned,
    createdAt: row.created_at.toISOString(),
    deletedAt: row.deleted_at?.toISOString() ?? null,
    masked: row.masked,
  };
}
