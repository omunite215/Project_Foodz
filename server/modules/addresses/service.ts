import 'server-only';
import { GeoUnavailableError, searchPlaces } from '@/lib/geo';
import { can } from '@/server/auth/roles';
import type { UserActor } from '@/server/auth/session';
import { type DbContext, runAs } from '@/server/db/context';
import { AppError, demoReadOnly, forbidden, limitReached, unavailable } from '@/server/errors';
import { enforceRateLimit } from '@/server/security/rate-limit';
import { deliveryFigures } from '@/server/modules/cart/pricing';
import {
  type AddressWrite,
  checkPoint,
  checkSaved,
  clearDefault,
  countOwn,
  findDefaultOwn,
  findNewest,
  findOwn,
  findRecentDuplicate,
  findStore,
  insert,
  listForStaff,
  listOwn,
  lockAddressBook,
  markDefault,
  remove,
  update,
} from './repo';
import {
  ADDRESS_LIMIT,
  type AddressBook,
  type AddressDto,
  type AddressFields,
  addressIdInput,
  addressSearchInput,
  type AddressSuggestion,
  createAddressInput,
  type DeleteAddressResult,
  type DeliveryCheck,
  deliveryCheckInput,
  type DeliveryEstimate,
  deliveryMessage,
  labelFor,
  type StaffAddressView,
  type StoreArea,
  updateAddressInput,
} from './schema';

const notFoundAddress = () => new AppError('NOT_FOUND', 'Address not found.', 404);
const DUPLICATE_WINDOW_MS = 30_000;
const SEARCH_UNAVAILABLE = "We can't look up addresses right now. Please try again in a minute.";

const toKm = (meters: number | null | undefined) =>
  meters === null || meters === undefined ? 0 : Math.round(meters / 100) / 10;

const streetOf = (addressText: string) => addressText.split(',')[0]?.trim() || addressText;

type AddressRow = Awaited<ReturnType<typeof listOwn>>[number];

function toDto(
  row: AddressRow,
  area?: { distance_m: number | null; inside: boolean | null } | null,
): AddressDto {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    notes: row.notes,
    lat: row.lat,
    lng: row.lng,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    deliverable: Boolean(area?.inside),
    distanceKm: toKm(area?.distance_m),
  };
}

function toWrite(data: AddressFields): AddressWrite {
  return {
    kind: data.kind,
    label: labelFor(data.kind, data.label),
    line1: data.line1,
    line2: data.line2 ?? null,
    city: data.city,
    notes: data.notes ?? null,
    lat: data.lat,
    lng: data.lng,
  };
}

/** Writes are for the owner only, never for the shared demo accounts (U2). */
function assertCanEdit(actor: UserActor) {
  if (!can(actor.role, { address: ['manage-own'] })) throw forbidden();
  if (actor.isDemo) throw demoReadOnly();
}

async function storeArea(ctx: DbContext): Promise<StoreArea> {
  const store = await findStore(ctx);
  if (!store) throw new Error('Store settings are missing. Run the seed.');
  return {
    addressText: store.addressText,
    street: streetOf(store.addressText),
    radiusKm: store.radiusKm,
  };
}

/** Inside the radius, or throws the S4.6 "outside" error. Returns the check for the DTO. */
async function requireInside(ctx: DbContext, data: AddressWrite) {
  const area = await checkPoint(ctx, data.lat, data.lng);
  if (!area) throw new Error('Store settings are missing. Run the seed.');
  if (!area.inside) {
    const distanceKm = toKm(area.distance_m);
    throw new AppError(
      'OUTSIDE_DELIVERY_AREA',
      deliveryMessage({
        deliverable: false,
        distanceKm,
        radiusKm: area.radius_km,
        storeStreet: streetOf(area.address_text),
        line1: data.line1,
        edge: distanceKm <= area.radius_km ? 'justOver' : null,
      }),
      422,
      { details: { distanceKm, radiusKm: area.radius_km } },
    );
  }
  return area;
}

// ------------------------------------------------------------------ reads

export async function getAddressBook(actor: UserActor): Promise<AddressBook> {
  return runAs(actor, async (ctx) => {
    const [rows, areas, store] = await Promise.all([
      listOwn(ctx, actor.userId),
      checkSaved(ctx, actor.userId),
      storeArea(ctx),
    ]);
    return {
      addresses: rows.map((row) => toDto(row, areas.get(row.id))),
      limit: ADDRESS_LIMIT,
      canAdd: !actor.isDemo && rows.length < ADDRESS_LIMIT,
      canEdit: !actor.isDemo,
      store,
    };
  });
}

/** One of the caller's addresses; null for a malformed, unknown or someone else's id. */
export async function getAddress(actor: UserActor, id: string): Promise<AddressDto | null> {
  const parsed = addressIdInput.safeParse({ id });
  if (!parsed.success) return null;
  return runAs(actor, async (ctx) => {
    const row = await findOwn(ctx, actor.userId, parsed.data.id);
    if (!row) return null;
    const areas = await checkSaved(ctx, actor.userId);
    return toDto(row, areas.get(row.id));
  });
}

export async function countMyAddresses(actor: UserActor) {
  return runAs(actor, (ctx) => countOwn(ctx, actor.userId));
}

/** For the data export: the caller's addresses as stored. */
export async function listMyAddresses(actor: UserActor) {
  return runAs(actor, (ctx) => listOwn(ctx, actor.userId));
}

// ------------------------------------------------------------------ search and delivery check

export async function searchAddresses(
  _actor: UserActor,
  input: unknown,
): Promise<AddressSuggestion[]> {
  return findPlaces(input);
}

/**
 * The same search for a signed-out visitor checking an address in the cart (F3 U2). Besides the
 * per-network limit, guest lookups share one site-wide cap (F3 security S6), so visitors can't
 * push the site past Photon's fair use and get it blocked there. Over the cap, the search says
 * it can't look addresses up right now, as when the service is down.
 */
export async function searchAddressesAsGuest(input: unknown): Promise<AddressSuggestion[]> {
  try {
    await enforceRateLimit('geo.photon', 'guests');
  } catch (error) {
    if (error instanceof AppError && error.code === 'RATE_LIMITED') {
      throw unavailable(SEARCH_UNAVAILABLE);
    }
    throw error;
  }
  return findPlaces(input);
}

async function findPlaces(input: unknown): Promise<AddressSuggestion[]> {
  const { query } = addressSearchInput.parse(input);
  const store = await runAs({ kind: 'anonymous' }, findStore);
  if (!store) throw new Error('Store settings are missing. Run the seed.');
  try {
    return await searchPlaces(query, { lat: store.lat, lng: store.lng });
  } catch (error) {
    if (error instanceof GeoUnavailableError) throw unavailable(SEARCH_UNAVAILABLE);
    throw error;
  }
}

/** Decided on the server from the store settings (S4.6); demo accounts may run it (U2). */
export async function checkDeliveryArea(actor: UserActor, input: unknown): Promise<DeliveryCheck> {
  const { lat, lng, line1 } = deliveryCheckInput.parse(input);
  return runAs(actor, async (ctx) => {
    const area = await checkPoint(ctx, lat, lng);
    if (!area) throw new Error('Store settings are missing. Run the seed.');
    const result = {
      deliverable: Boolean(area.inside),
      distanceKm: toKm(area.distance_m),
      radiusKm: area.radius_km,
      storeAddress: area.address_text,
      storeStreet: streetOf(area.address_text),
    };
    const edge = !result.deliverable && result.distanceKm <= result.radiusKm ? 'justOver' : null;
    return { ...result, message: deliveryMessage({ ...result, line1, edge }) };
  });
}

/**
 * The delivery fee for any point, checked without saving anything (F3 U2): for guests in the
 * cart, and for anyone who hasn't saved an address. Decided on the server from the store
 * settings, exactly as the cart's quote will.
 */
export async function estimateDelivery(input: unknown): Promise<DeliveryEstimate> {
  const { lat, lng, line1 } = deliveryCheckInput.parse(input);
  const area = await runAs({ kind: 'anonymous' }, (ctx) => checkPoint(ctx, lat, lng));
  if (!area) throw new Error('Store settings are missing. Run the seed.');
  const figures = deliveryFigures(
    { status: area.inside ? 'inside' : 'outside', distanceMeters: area.distance_m ?? 0 },
    {
      taxRateBps: 0,
      baseDeliveryFeeCents: area.base_fee_cents,
      perKmFeeCents: area.per_km_fee_cents,
      deliveryRadiusKm: area.radius_km,
    },
  );
  const result = {
    deliverable: Boolean(area.inside),
    distanceKm: figures.distanceKm ?? 0,
    radiusKm: area.radius_km,
    storeAddress: area.address_text,
    storeStreet: streetOf(area.address_text),
  };
  return {
    ...result,
    edge: figures.edge,
    feeCents: figures.feeCents,
    feeRange: figures.feeRange,
    message: deliveryMessage({ ...result, line1, edge: figures.edge }),
  };
}

// ------------------------------------------------------------------ delivery points for the cart

/** Where a quote delivers to: the exact distance (metres) and whether it is inside the area. */
export interface DeliveryPointCheck {
  distanceMeters: number;
  inside: boolean;
}

export interface SavedDeliveryPoint extends DeliveryPointCheck {
  id: string;
  label: string;
  line1: string;
}

/**
 * One of the caller's saved addresses with its distance, or their default one. Null for an
 * unknown or someone else's id, or when there is no default (row-level security agrees).
 */
export async function locateSavedAddress(
  actor: UserActor,
  which: { id: string } | 'default',
): Promise<SavedDeliveryPoint | null> {
  const id = which === 'default' ? null : addressIdInput.parse(which).id;
  return runAs(actor, async (ctx) => {
    const row = id ? await findOwn(ctx, actor.userId, id) : await findDefaultOwn(ctx, actor.userId);
    if (!row) return null;
    const area = await checkPoint(ctx, row.lat, row.lng);
    if (!area) throw new Error('Store settings are missing. Run the seed.');
    return {
      id: row.id,
      label: row.label,
      line1: row.line1,
      distanceMeters: area.distance_m ?? 0,
      inside: Boolean(area.inside),
    };
  });
}

/** Any point's distance from the kitchen (an address checked without saving it). */
export async function locatePoint(lat: number, lng: number): Promise<DeliveryPointCheck> {
  const { lat: checkedLat, lng: checkedLng } = deliveryCheckInput.parse({ lat, lng });
  const area = await runAs({ kind: 'anonymous' }, (ctx) => checkPoint(ctx, checkedLat, checkedLng));
  if (!area) throw new Error('Store settings are missing. Run the seed.');
  return { distanceMeters: area.distance_m ?? 0, inside: Boolean(area.inside) };
}

// ------------------------------------------------------------------ writes

export async function createAddress(actor: UserActor, input: unknown): Promise<AddressDto> {
  assertCanEdit(actor);
  const parsed = createAddressInput.parse(input);
  const data = toWrite(parsed);

  return runAs(actor, async (ctx) => {
    await lockAddressBook(ctx, actor.userId);

    const since = new Date(Date.now() - DUPLICATE_WINDOW_MS);
    const duplicate = await findRecentDuplicate(ctx, actor.userId, data, since);
    if (duplicate) return toDto(duplicate, await checkPoint(ctx, data.lat, data.lng));

    const count = await countOwn(ctx, actor.userId);
    if (count >= ADDRESS_LIMIT) {
      throw limitReached(
        `You can save up to ${ADDRESS_LIMIT} addresses. Delete one to add another.`,
      );
    }
    const area = await requireInside(ctx, data);

    // The first address is the default by itself.
    const isDefault = parsed.isDefault || count === 0;
    if (isDefault) await clearDefault(ctx, actor.userId);
    return toDto(await insert(ctx, actor.userId, data, isDefault), area);
  });
}

export async function updateAddress(actor: UserActor, input: unknown): Promise<AddressDto> {
  assertCanEdit(actor);
  const { id, ...parsed } = updateAddressInput.parse(input);
  const data = toWrite(parsed);

  return runAs(actor, async (ctx) => {
    await lockAddressBook(ctx, actor.userId);
    const existing = await findOwn(ctx, actor.userId, id);
    if (!existing) throw notFoundAddress();
    const area = await requireInside(ctx, data);

    // Unticking "default" never leaves the book without one; choose another address instead.
    const isDefault = existing.isDefault || parsed.isDefault;
    if (isDefault && !existing.isDefault) await clearDefault(ctx, actor.userId);
    if ((await update(ctx, actor.userId, id, data, isDefault)) === 0) throw notFoundAddress();

    const row = await findOwn(ctx, actor.userId, id);
    if (!row) throw notFoundAddress();
    return toDto(row, area);
  });
}

export async function setDefaultAddress(actor: UserActor, input: unknown): Promise<AddressDto> {
  assertCanEdit(actor);
  const { id } = addressIdInput.parse(input);

  return runAs(actor, async (ctx) => {
    await lockAddressBook(ctx, actor.userId);
    if (!(await findOwn(ctx, actor.userId, id))) throw notFoundAddress();
    await clearDefault(ctx, actor.userId);
    await markDefault(ctx, actor.userId, id);
    const row = await findOwn(ctx, actor.userId, id);
    if (!row) throw notFoundAddress();
    const areas = await checkSaved(ctx, actor.userId);
    return toDto(row, areas.get(row.id));
  });
}

export async function deleteAddress(
  actor: UserActor,
  input: unknown,
): Promise<DeleteAddressResult> {
  assertCanEdit(actor);
  const { id } = addressIdInput.parse(input);

  return runAs(actor, async (ctx) => {
    await lockAddressBook(ctx, actor.userId);
    const existing = await findOwn(ctx, actor.userId, id);
    if (!existing) throw notFoundAddress();
    if ((await remove(ctx, actor.userId, id)) === 0) throw notFoundAddress();

    let newDefault: DeleteAddressResult['newDefault'] = null;
    if (existing.isDefault) {
      const newest = await findNewest(ctx, actor.userId);
      if (newest) {
        await markDefault(ctx, actor.userId, newest.id);
        newDefault = { id: newest.id, label: newest.label };
      }
    }
    return { deletedId: id, newDefault };
  });
}

// ------------------------------------------------------------------ staff (U4)

/**
 * Another person's addresses for staff screens (F11). The database masks personal details when
 * the actor is a demo login, so this cannot leak a real customer's address to the demo admin.
 */
export async function listAddressesForStaff(
  actor: UserActor,
  userId: string,
): Promise<StaffAddressView[]> {
  if (!can(actor.role, { user: ['get'] })) throw forbidden();
  const { id } = addressIdInput.parse({ id: userId });
  const rows = await runAs(actor, (ctx) => listForStaff(ctx, id));
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    label: row.label,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    notes: row.notes,
    lat: row.lat,
    lng: row.lng,
    isDefault: row.is_default,
    createdAt: row.created_at.toISOString(),
    masked: row.masked,
  }));
}
