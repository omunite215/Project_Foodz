import 'server-only';
import { z } from 'zod';
import { can } from '@/server/auth/roles';
import type { UserActor } from '@/server/auth/session';
import { type DbContext, runAsSystem } from '@/server/db/context';
import { AppError, demoReadOnly, forbidden, unavailable } from '@/server/errors';
import { logger } from '@/server/logger';
import {
  brandLabel,
  cardLabel,
  cardSpoken,
  expiryText,
  isCardExpired,
} from '@/server/modules/orders/text';
import {
  type PaymentGateway,
  paymentGateway,
  PaymentProviderError,
  type SavedCardRecord,
  stripeSettings,
} from '@/server/payments/stripe';
import { redis, waitUntilReady } from '@/server/redis';
import {
  clearStripeCustomerId,
  findInstanceTag,
  findStripeCustomerId,
  lockStripeCustomer,
  recordWebhookEvent as insertWebhookEvent,
  saveStripeCustomerId,
} from './repo';
import {
  removeSavedCardInput,
  SAVED_CARD_LIMIT,
  type SavedCardDto,
  type SavedCardsPage,
  type StripeConfigDto,
} from './schema';

/*
 * Saved cards (S6.10 to S6.14, U4, B12) and the Stripe customer behind them. A customer is made
 * the first time a card is saved, never for the demo account. Cards are listed from Stripe and
 * cached for a minute; paying with or removing a card first checks it is the caller's own.
 */

const DEMO_CANNOT_ORDER = "Demo accounts can't place orders.";
const NOT_SET_UP = "Card payments aren't set up on this computer.";
const CARD_GONE = 'That card is no longer saved.';
const CARDS_UNAVAILABLE = "We couldn't reach our payment provider. Try again in a moment.";
const CACHE_SECONDS = 60;

export const notConfigured = () => new AppError('STRIPE_NOT_CONFIGURED', NOT_SET_UP, 503);
const cardNotFound = () => new AppError('NOT_FOUND', CARD_GONE, 404);

export function getStripeConfig(): StripeConfigDto {
  return stripeSettings();
}

/** The gateway, or the "not set up" refusal. */
export function requireGateway(): PaymentGateway {
  const gateway = paymentGateway();
  if (!gateway) throw notConfigured();
  return gateway;
}

// ------------------------------------------------------------------ this database's tag (B6)

let instanceTag: string | undefined;

export async function getInstanceTag(): Promise<string> {
  if (instanceTag) return instanceTag;
  const tag = await runAsSystem('instance tag', findInstanceTag);
  if (!tag) throw new Error('app_instance is empty. Run the migrations.');
  instanceTag = tag;
  return tag;
}

/** Inside the caller's transaction: true for a new event id, false for a replay (B6). */
export function recordWebhookEvent(ctx: DbContext, id: string, type: string) {
  return insertWebhookEvent(ctx, id, type);
}

// ------------------------------------------------------------------ the Stripe customer

export async function findStripeCustomer(userId: string): Promise<string | null> {
  const row = await runAsSystem('stripe customer', (ctx) => findStripeCustomerId(ctx, userId));
  return row?.stripeCustomerId ?? null;
}

/** The account's Stripe customer, made on first use. Never for the demo account (U3). */
export async function ensureStripeCustomer(actor: UserActor): Promise<string> {
  if (actor.isDemo) throw demoReadOnly(DEMO_CANNOT_ORDER);
  const gateway = requireGateway();
  const existing = await findStripeCustomer(actor.userId);
  if (existing) return existing;
  const instance = await getInstanceTag();
  return runAsSystem('stripe customer', async (ctx) => {
    await lockStripeCustomer(ctx, actor.userId);
    const row = await findStripeCustomerId(ctx, actor.userId);
    if (row?.stripeCustomerId) return row.stripeCustomerId;
    if (row?.isDemo) throw demoReadOnly(DEMO_CANNOT_ORDER);
    const id = await gateway.createCustomer({
      userId: actor.userId,
      instance,
      idempotencyKey: `customer-${instance}-${actor.userId}`,
    });
    await saveStripeCustomerId(ctx, actor.userId, id);
    return id;
  });
}

// ------------------------------------------------------------------ cards

const cacheKey = (customerId: string) => `stripe:cards:${customerId}`;

const cachedCardsSchema = z.array(
  z.object({
    id: z.string(),
    brand: z.string(),
    last4: z.string(),
    expMonth: z.int(),
    expYear: z.int(),
    fingerprint: z.string().nullable(),
    createdAt: z.coerce.date(),
  }),
);

async function cachedCards(customerId: string): Promise<SavedCardRecord[] | null> {
  try {
    await waitUntilReady();
    const raw = await redis.get(cacheKey(customerId));
    if (!raw) return null;
    const parsed = cachedCardsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function forgetCards(customerId: string) {
  try {
    await waitUntilReady();
    await redis.del(cacheKey(customerId));
  } catch (error) {
    logger.warn({ err: error }, 'could not clear the saved-cards cache');
  }
}

async function cardsOf(gateway: PaymentGateway, customerId: string): Promise<SavedCardRecord[]> {
  const cached = await cachedCards(customerId);
  if (cached) return cached;
  const cards = await gateway.listCards(customerId);
  try {
    await waitUntilReady();
    await redis.set(cacheKey(customerId), JSON.stringify(cards), 'EX', CACHE_SECONDS);
  } catch {
    // The list is only cached to spare Stripe; it works without.
  }
  return cards;
}

export function toSavedCardDto(
  card: SavedCardRecord,
  now: Date,
  lastUsedAt: Date | null = null,
): SavedCardDto {
  return {
    id: card.id,
    brand: card.brand,
    brandLabel: brandLabel(card.brand),
    last4: card.last4,
    expMonth: card.expMonth,
    expYear: card.expYear,
    expired: isCardExpired(card.expMonth, card.expYear, now),
    label: cardLabel(card.brand, card.last4),
    spoken: cardSpoken(card.brand, card.last4),
    expiry: expiryText(card.expMonth, card.expYear),
    lastUsedAt: lastUsedAt?.toISOString() ?? null,
  };
}

/**
 * The caller's saved cards, newest first: brand, last 4 and expiry only (S6.14). Empty for the
 * demo account, without Stripe keys, and before any card was saved.
 */
export async function listMySavedCards(actor: UserActor): Promise<SavedCardRecord[]> {
  if (actor.isDemo) return [];
  const gateway = paymentGateway();
  if (!gateway) return [];
  const customerId = await findStripeCustomer(actor.userId);
  if (!customerId) return [];
  const cards = await cardsOf(gateway, customerId);
  return cards.toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** For the saved-cards action: refuses the demo account and a machine without Stripe keys. */
export async function listSavedCards(actor: UserActor, now = new Date()) {
  if (!can(actor.role, { account: ['update-own'] })) throw forbidden();
  if (actor.isDemo) throw demoReadOnly(DEMO_CANNOT_ORDER);
  if (!paymentGateway()) throw notConfigured();
  try {
    const cards = await listMySavedCards(actor);
    return { cards: cards.map((card) => toSavedCardDto(card, now)), limit: SAVED_CARD_LIMIT };
  } catch (error) {
    if (error instanceof PaymentProviderError) throw unavailable(CARDS_UNAVAILABLE);
    throw error;
  }
}

/** /account/cards, server-rendered (design 5.4). */
export async function getSavedCardsPage(
  actor: UserActor,
  now = new Date(),
): Promise<SavedCardsPage> {
  if (actor.isDemo) return { state: 'demo' };
  if (!paymentGateway()) return { state: 'notConfigured' };
  try {
    const cards = await listMySavedCards(actor);
    return {
      state: 'ok',
      cards: cards.map((card) => toSavedCardDto(card, now)),
      limit: SAVED_CARD_LIMIT,
    };
  } catch (error) {
    if (error instanceof PaymentProviderError) return { state: 'unavailable' };
    throw error;
  }
}

/** How many cards the account has saved, for the skeleton (0 when unknown). */
export async function countSavedCards(actor: UserActor): Promise<number> {
  try {
    return (await listMySavedCards(actor)).length;
  } catch (error) {
    logger.warn({ err: error }, 'could not count saved cards');
    return 0;
  }
}

/**
 * One of the caller's own saved cards, with its customer; null for someone else's card, an
 * unknown id, or none saved (S6.14: answered as "not found", nothing charged).
 */
export async function findOwnCard(
  actor: UserActor,
  paymentMethodId: string,
): Promise<(SavedCardRecord & { customerId: string }) | null> {
  if (actor.isDemo) return null;
  const gateway = requireGateway();
  const customerId = await findStripeCustomer(actor.userId);
  if (!customerId) return null;
  const card = await gateway.retrieveCard(paymentMethodId);
  if (!card || card.customerId !== customerId) return null;
  return { ...card, customerId };
}

export async function removeSavedCard(
  actor: UserActor,
  input: unknown,
): Promise<{ removedId: string }> {
  if (!can(actor.role, { account: ['update-own'] })) throw forbidden();
  if (actor.isDemo) throw demoReadOnly(DEMO_CANNOT_ORDER);
  const { paymentMethodId } = removeSavedCardInput.parse(input);
  const gateway = requireGateway();
  try {
    const card = await findOwnCard(actor, paymentMethodId);
    if (!card) throw cardNotFound();
    await gateway.detachCard(card.id);
    await forgetCards(card.customerId);
  } catch (error) {
    if (error instanceof PaymentProviderError) throw unavailable(CARDS_UNAVAILABLE);
    throw error;
  }
  return { removedId: paymentMethodId };
}

/**
 * After a payment that saved a card (U4): the same card twice is kept once (the older entry
 * stays), and a sixth card is not kept.
 */
export async function keepSavedCard(input: {
  customerId: string;
  paymentMethodId: string;
  fingerprint: string | null;
}) {
  const gateway = paymentGateway();
  if (!gateway) return;
  await forgetCards(input.customerId);
  const cards = (await gateway.listCards(input.customerId)).toSorted(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const others = cards.filter((card) => card.id !== input.paymentMethodId);
  const duplicate =
    input.fingerprint !== null && others.some((card) => card.fingerprint === input.fingerprint);
  if (duplicate || others.length >= SAVED_CARD_LIMIT) {
    await gateway.detachCard(input.paymentMethodId);
  }
  await forgetCards(input.customerId);
}

// ------------------------------------------------------------------ account deletion and export

/** B21: removes the Stripe customer, which removes its cards, then forgets the id. */
export async function deleteStripeCustomer(userId: string): Promise<void> {
  const customerId = await findStripeCustomer(userId);
  if (!customerId) return;
  const gateway = paymentGateway();
  if (gateway) {
    await gateway.deleteCustomer(customerId);
    await forgetCards(customerId);
  }
  await runAsSystem('stripe customer removed', (ctx) => clearStripeCustomerId(ctx, userId));
}

/** S12.7: brand, last 4 and expiry of each saved card; empty when Stripe can't be reached. */
export async function exportSavedCards(actor: UserActor) {
  try {
    const cards = await listMySavedCards(actor);
    return cards.map((card) => ({
      brand: brandLabel(card.brand),
      last4: card.last4,
      expires: expiryText(card.expMonth, card.expYear),
    }));
  } catch (error) {
    logger.warn({ err: error }, 'saved cards left out of a data export');
    return [];
  }
}
