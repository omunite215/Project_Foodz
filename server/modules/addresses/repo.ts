import 'server-only';
import { db } from '@/server/db/client';
import type { DbContext } from '@/server/db/context';
import type { AddressKind } from './schema';

/*
 * Row-level security limits every query here to the caller's own addresses (support and admin
 * may read others; demo logins may not write). Staff reads of other people's addresses go
 * through the address_directory view, which masks personal details for demo staff.
 */

const fields = {
  id: true,
  kind: true,
  label: true,
  line1: true,
  line2: true,
  city: true,
  notes: true,
  lat: true,
  lng: true,
  isDefault: true,
  createdAt: true,
} as const;

export interface AddressWrite {
  kind: AddressKind;
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  notes: string | null;
  lat: number;
  lng: number;
}

/** Serialises address-book changes per user, so limits and the single default hold. */
export async function lockAddressBook(ctx: DbContext, userId: string) {
  await db(ctx)
    .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`addresses:${userId}`}, 0))`;
}

export function listOwn(ctx: DbContext, userId: string) {
  return db(ctx).address.findMany({
    where: { userId },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    select: fields,
  });
}

export function findOwn(ctx: DbContext, userId: string, id: string) {
  return db(ctx).address.findFirst({ where: { id, userId }, select: fields });
}

export function countOwn(ctx: DbContext, userId: string) {
  return db(ctx).address.count({ where: { userId } });
}

/** The same address saved by the same person moments ago (a double submit). */
export function findRecentDuplicate(
  ctx: DbContext,
  userId: string,
  data: AddressWrite,
  since: Date,
) {
  return db(ctx).address.findFirst({
    where: {
      userId,
      kind: data.kind,
      label: data.label,
      line1: data.line1,
      line2: data.line2,
      city: data.city,
      notes: data.notes,
      lat: data.lat,
      lng: data.lng,
      createdAt: { gte: since },
    },
    select: fields,
  });
}

export function insert(ctx: DbContext, userId: string, data: AddressWrite, isDefault: boolean) {
  return db(ctx).address.create({
    data: {
      userId,
      kind: data.kind,
      label: data.label,
      line1: data.line1,
      line2: data.line2,
      city: data.city,
      notes: data.notes,
      lat: data.lat,
      lng: data.lng,
      isDefault,
    },
    select: fields,
  });
}

export async function update(
  ctx: DbContext,
  userId: string,
  id: string,
  data: AddressWrite,
  isDefault: boolean,
) {
  const result = await db(ctx).address.updateMany({
    where: { id, userId },
    data: {
      kind: data.kind,
      label: data.label,
      line1: data.line1,
      line2: data.line2,
      city: data.city,
      notes: data.notes,
      lat: data.lat,
      lng: data.lng,
      isDefault,
    },
  });
  return result.count;
}

export async function clearDefault(ctx: DbContext, userId: string) {
  await db(ctx).address.updateMany({
    where: { userId, isDefault: true },
    data: { isDefault: false },
  });
}

export async function markDefault(ctx: DbContext, userId: string, id: string) {
  const result = await db(ctx).address.updateMany({
    where: { id, userId },
    data: { isDefault: true },
  });
  return result.count;
}

export async function remove(ctx: DbContext, userId: string, id: string) {
  const result = await db(ctx).address.deleteMany({ where: { id, userId } });
  return result.count;
}

/** The caller's default address, if any. */
export function findDefaultOwn(ctx: DbContext, userId: string) {
  return db(ctx).address.findFirst({
    where: { userId, isDefault: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: fields,
  });
}

/** The most recently added address, to become the default after the default is deleted. */
export function findNewest(ctx: DbContext, userId: string) {
  return db(ctx).address.findFirst({
    where: { userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, label: true },
  });
}

// ------------------------------------------------------------------ delivery area

export interface StoreRow {
  addressText: string;
  lat: number;
  lng: number;
  radiusKm: number;
}

export async function findStore(ctx: DbContext): Promise<StoreRow | null> {
  const row = await db(ctx).siteSettings.findUnique({
    where: { id: 1 },
    select: { addressText: true, lat: true, lng: true, deliveryRadiusKm: true },
  });
  return row
    ? { addressText: row.addressText, lat: row.lat, lng: row.lng, radiusKm: row.deliveryRadiusKm }
    : null;
}

interface AreaRow {
  distance_m: number | null;
  inside: boolean | null;
  radius_km: number;
  address_text: string;
  base_fee_cents: number;
  per_km_fee_cents: number;
}

/**
 * Straight-line distance from the kitchen and whether a point is inside the radius, with the
 * fee settings the cart needs.
 */
export async function checkPoint(ctx: DbContext, lat: number, lng: number) {
  const rows = await db(ctx).$queryRaw<AreaRow[]>`
    SELECT
      ST_Distance(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, location) AS distance_m,
      ST_DWithin(
        ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
        location,
        delivery_radius_km * 1000
      ) AS inside,
      delivery_radius_km AS radius_km,
      address_text,
      base_delivery_fee_cents AS base_fee_cents,
      per_km_fee_cents
    FROM site_settings
    WHERE id = 1`;
  return rows[0] ?? null;
}

/** The same for every saved address of a user: id → { distance, inside }. */
export async function checkSaved(ctx: DbContext, userId: string) {
  const rows = await db(ctx).$queryRaw<
    { id: string; distance_m: number | null; inside: boolean | null }[]
  >`
    SELECT
      a.id::text AS id,
      ST_Distance(a.location, s.location) AS distance_m,
      ST_DWithin(a.location, s.location, s.delivery_radius_km * 1000) AS inside
    FROM addresses a
    CROSS JOIN site_settings s
    WHERE s.id = 1 AND a.user_id = ${userId}::uuid`;
  return new Map(rows.map((row) => [row.id, row]));
}

// ------------------------------------------------------------------ staff

interface DirectoryRow {
  id: string;
  user_id: string;
  kind: AddressKind;
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  notes: string | null;
  lat: number;
  lng: number;
  is_default: boolean;
  created_at: Date;
  masked: boolean;
}

/** Another person's addresses as staff see them; masked for demo staff by the view. */
export async function listForStaff(ctx: DbContext, userId: string) {
  const rows = await db(ctx).$queryRaw<DirectoryRow[]>`
    SELECT id::text AS id, user_id::text AS user_id, kind::text AS kind, label, line1, line2, city,
           notes, lat, lng, is_default, created_at, masked
    FROM address_directory
    WHERE user_id = ${userId}::uuid
    ORDER BY is_default DESC, created_at DESC`;
  return rows;
}
