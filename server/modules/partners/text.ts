import { formatClock } from '@/lib/format';
import type { PartnerAvailabilityReason } from '@/lib/realtime/events';
import type { VehicleType } from '@/server/db/enums';
import type { StoreMoment } from '@/server/modules/menu/schema';
import { clockAt, openingPhrase } from '@/server/modules/orders/text';
import type { AutoOfflineReason } from './location';
import type { IdDocumentType, IsoDate } from './rules';

/*
 * Ready-made words the partner and staff screens show (F6 design "[BE] needs"). US spelling
 * (lead decision, 22 Nov 2026). Times are in the store's time zone.
 */

export const VEHICLE_WORDS: Record<VehicleType, string> = {
  BICYCLE: 'Bicycle or e-bike',
  SCOOTER: 'Scooter or moped',
  MOTORBIKE: 'Motorbike',
  CAR: 'Car',
};

export const DOCUMENT_WORDS: Record<IdDocumentType, string> = {
  DRIVER_LICENSE: "Driver's license",
  STATE_ID: 'State ID card',
  PASSPORT: 'Passport',
};

/** "license", "ID card", "passport": the noun inside sentences. */
export const DOCUMENT_NOUN: Record<IdDocumentType, string> = {
  DRIVER_LICENSE: 'license',
  STATE_ID: 'ID card',
  PASSPORT: 'passport',
};

/** "Scooter or moped · 7KT 342", "Bicycle or e-bike". */
export const vehicleLine = (vehicle: VehicleType, plate: string | null): string =>
  plate ? `${VEHICLE_WORDS[vehicle]} · ${plate}` : VEHICLE_WORDS[vehicle];

const UTC_DATE = { timeZone: 'UTC' } as const;

/** "Mar 3, 2029" for a calendar date. */
export const longDate = (date: IsoDate): string =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    ...UTC_DATE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

/** "Thu, Dec 17, 2026" for a calendar date. */
export const weekdayDate = (date: IsoDate): string =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    ...UTC_DATE,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

/** "Fri, Nov 20 · 5:12 pm" for an instant. */
export function dayAndTime(iso: string, timeZone: string): string {
  const day = new Date(iso).toLocaleDateString('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  return `${day} · ${clockAt(iso, timeZone)}`;
}

/** The store's calendar date of an instant, "2026-11-20". */
export function storeDate(iso: string | Date, timeZone: string): IsoDate {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

/** "Driver's license ending 4821 · expires Mar 3, 2029" (P4.7, P6.1). Never more digits. */
export const documentLine = (type: IdDocumentType, last4: string, expiresOn: IsoDate): string =>
  `${DOCUMENT_WORDS[type]} ending ${last4} · expires ${longDate(expiresOn)}`;

/**
 * "ana…@…" (P1.4, P6.1): enough for the owner to recognise the address on a screen others may
 * see. The full address goes only to the owner's sign-in hand-off.
 */
export function maskedEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  return `${local.slice(0, 3)}…@…`;
}

// ------------------------------------------------------------------ the kitchen

interface KitchenMoment {
  isOpen: boolean;
  closesAt: StoreMoment | null;
  opensAt: StoreMoment | null;
}

/** The offline home's chip (P9.1): "Foodz Kitchen is open · closes 11 pm". */
export function kitchenOfflineLine(store: KitchenMoment): string {
  if (store.isOpen) {
    return store.closesAt
      ? `Foodz Kitchen is open · closes ${formatClock(store.closesAt.time)}`
      : 'Foodz Kitchen is open';
  }
  return store.opensAt
    ? `Foodz Kitchen is closed · opens ${openingPhrase(store.opensAt)}`
    : 'Foodz Kitchen is closed';
}

/** The idle screen's line (P10.6): "Foodz Kitchen is closed. Orders start when it opens at 11 am." */
export function kitchenOnlineLine(store: KitchenMoment): string {
  if (store.isOpen) return kitchenOfflineLine(store);
  return store.opensAt
    ? `Foodz Kitchen is closed. Orders start when it opens at ${formatClock(store.opensAt.time)}.`
    : 'Foodz Kitchen is closed.';
}

// ------------------------------------------------------------------ taken offline

/** Every reason an availability change can carry (design "[BE] needs"), as the event names them. */
export type OfflineReason = PartnerAvailabilityReason;

/** Reasons the offline home explains with a notice (design 6.6). */
export type NoticedOfflineReason = Exclude<OfflineReason, 'self' | 'signed-out' | 'suspended'>;

/**
 * The offline home's notice (design 6.6). The two "no location" sentences come from one
 * reason; the app shows `ifDisconnected` when it had no connection itself (D20).
 */
export function offlineNotice(
  reason: NoticedOfflineReason,
  at: string,
  timeZone: string,
  kitchenClosedAt?: string | null,
): { words: string; ifDisconnected: string | null } {
  const time = clockAt(at, timeZone);
  switch (reason) {
    case 'no-location':
      return {
        words: `You went offline at ${time} because we hadn't had your location for 10 minutes.`,
        ifDisconnected: `You went offline at ${time} because we lost your connection for 10 minutes.`,
      };
    case 'kitchen-closed':
      return {
        words: `Foodz Kitchen closed at ${clockAt(kitchenClosedAt ?? at, timeZone)}, so we took you offline.`,
        ifDisconnected: null,
      };
    case 'other-device':
      return {
        words: 'You went online on another device, so sharing stopped here.',
        ifDisconnected: null,
      };
    default:
      return { words: 'Another visitor took the demo partner offline.', ifDisconnected: null };
  }
}

// ------------------------------------------------------------------ online state for staff

/** A20.5, B33: whether an approved or suspended partner is online. Never where. */
export type StaffOnlineState =
  | { kind: 'online'; since: string; lastPointAt: string }
  | { kind: 'stale'; since: string; lastPointAt: string | null }
  | { kind: 'offline'; lastSeenAt: string | null }
  | { kind: 'takenOffline'; reason: AutoOfflineReason | 'suspended'; at: string };

const secondsAgo = (from: string, now: Date) =>
  Math.max(0, Math.floor((now.getTime() - Date.parse(from)) / 1000));

function agoWords(from: string, now: Date): string {
  const seconds = secondsAgo(from, now);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${Math.floor(seconds / 10) * 10} s ago`;
  return `${Math.floor(seconds / 60)} min ago`;
}

/** The application page's line (design 8.7). Staff copy never says "he" or "she" (D2). */
export function staffOnlineWords(state: StaffOnlineState, now: Date, timeZone: string): string {
  switch (state.kind) {
    case 'online':
      return `Online since ${clockAt(state.since, timeZone)} · location shared ${agoWords(state.lastPointAt, now)}`;
    case 'stale': {
      const minutes = Math.floor(secondsAgo(state.lastPointAt ?? state.since, now) / 60);
      return `Online · no location for ${minutes} min, so they aren't offered orders`;
    }
    case 'offline':
      return state.lastSeenAt
        ? `Offline · last seen ${dayAndTime(state.lastSeenAt, timeZone)}`
        : 'Offline';
    default:
      if (state.reason === 'suspended') {
        return `Offline · taken offline by the suspension at ${clockAt(state.at, timeZone)}`;
      }
      return state.reason === 'no-location'
        ? `Offline · taken offline at ${clockAt(state.at, timeZone)} because we had no location for 10 minutes`
        : `Offline · taken offline at ${clockAt(state.at, timeZone)} because the kitchen had closed`;
  }
}

/** The list's shorter cell (design 7.5). */
export function staffOnlineCell(state: StaffOnlineState, now: Date, timeZone: string): string {
  switch (state.kind) {
    case 'online':
      return `Online since ${clockAt(state.since, timeZone)}`;
    case 'stale':
      return `Online · no location for ${Math.floor(secondsAgo(state.lastPointAt ?? state.since, now) / 60)} min`;
    default: {
      const seen = state.kind === 'offline' ? state.lastSeenAt : state.at;
      return seen ? `Offline · last seen ${dayAndTime(seen, timeZone)}` : 'Offline';
    }
  }
}
