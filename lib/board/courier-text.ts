import type { Tone } from '@/server/modules/board/timing';
import type {
  AssignableCourier,
  BoardCourier,
  CourierState,
  CourierTone,
  CouriersCount,
  DispatchRefusalDetails,
  OfferEnding,
  TakeOffReason,
} from '@/server/modules/delivery/schema';
import { REACHES_KM } from '@/server/modules/delivery/schema';
import { boardClock, clockWithSeconds } from './text';

/*
 * The staff words for couriers (F7 design 2, "Copy"): the courier line on Ready and Out for
 * delivery cards, the couriers chip, the offers list, the assign and take-off dialogs, the
 * no-courier banners, the board notices and the conflicts. The server resolves the state and
 * its words; these add the live seconds, the spoken forms and the sentences around them.
 * Staff copy never says "he" or "she".
 */

// ------------------------------------------------------------------ the courier line (2.1, 2.2)

/** Seconds left on an open offer, on the board's server clock; null without one. */
export function offerSecondsLeft(expiresAt: string | null, now: Date): number | null {
  if (!expiresAt) return null;
  return Math.max(0, Math.floor((Date.parse(expiresAt) - now.getTime()) / 1000));
}

const OPEN_OFFER: ReadonlySet<CourierState> = new Set(['offered', 'staffOffered']);
export const HELD: ReadonlySet<CourierState> = new Set(['assigned', 'assignedStale']);
/** States where an order has no courier and staff may send one (A37.1). */
export const UNASSIGNED: ReadonlySet<CourierState> = new Set([
  'starting',
  'offered',
  'between',
  'staffOffered',
  'escalated',
  'nobodyOnline',
  'notLooking',
]);

const FIXED_OPENING = /^(Finding|Offered|No couriers|No courier|Not looking)/;

/** "Scooter · 7KT 342" read aloud: "scooter, plate 7KT 342". */
export function vehicleSpoken(vehicleWords: string | null): string | null {
  if (!vehicleWords) return null;
  const [vehicle = '', plate] = vehicleWords.split(' · ');
  const kind = vehicle.toLowerCase();
  return plate ? `${kind}, plate ${plate}` : kind;
}

export interface CourierLineText {
  words: string;
  /** "24 s left", shown in tabular figures after the words; null without an open offer. */
  seconds: string | null;
  spoken: string;
  tone: CourierTone;
  state: CourierState;
}

/** The card facts the board's courier reads need. */
interface CourierCardFacts {
  id: string;
  status: string;
  version: number;
  courier?: BoardCourier | null;
}

/** One read per card version: a card that keeps no line after its read isn't asked again. */
export const courierReadKey = (card: CourierCardFacts): string => `${card.id}:${card.version}`;

/**
 * A34.1: Ready cards without a courier line. A card that moved to Ready, by the person's own
 * move or by anyone's event, keeps the line it had (none), and the first delivery change can be
 * a minute away: these are read at once, so "Finding a courier…" shows from the start.
 */
export function courierLinesToRead(
  cards: readonly CourierCardFacts[],
  asked: ReadonlySet<string>,
): string[] {
  return cards
    .filter((card) => card.status === 'READY' && !card.courier && !asked.has(courierReadKey(card)))
    .map((card) => card.id);
}

/**
 * The line as shown. Out for delivery (A34.2): the courier's name and vehicle only, neutral.
 * Never a live region; the board refreshes the seconds every 5 s (A34.3).
 */
export function courierLineText(
  courier: BoardCourier,
  now: Date,
  orderStatus = 'READY',
): CourierLineText {
  if (orderStatus === 'PICKED_UP' && HELD.has(courier.state) && courier.shortName) {
    const vehicle = courier.vehicleWords ? ` · ${courier.vehicleWords.replace(' · ', ' ')}` : '';
    const spokenVehicle = vehicleSpoken(courier.vehicleWords);
    return {
      words: `${courier.shortName}${vehicle}`,
      seconds: null,
      spoken: `Courier: ${courier.shortName}${spokenVehicle ? `, ${spokenVehicle}` : ''}`,
      tone: 'neutral',
      state: courier.state,
    };
  }
  const left = OPEN_OFFER.has(courier.state) ? offerSecondsLeft(courier.expiresAt, now) : null;
  const seconds = left === null ? null : `${left} s left`;
  let spoken: string;
  if (HELD.has(courier.state) && courier.state === 'assigned' && courier.shortName) {
    const parts = [courier.shortName, vehicleSpoken(courier.vehicleWords), courier.distanceWords];
    spoken = `Courier: ${parts.filter(Boolean).join(', ')}`;
  } else {
    // Only the line's own openings drop their capital; a name keeps it (review S4).
    const text = courier.words.replace(FIXED_OPENING, (opening) => opening.toLowerCase());
    spoken = `Courier: ${text.replaceAll(' · ', ', ')}${left === null ? '' : `, ${left} ${left === 1 ? 'second' : 'seconds'} left`}`;
  }
  return { words: courier.words, seconds, spoken, tone: courier.tone, state: courier.state };
}

/** The card's left border takes the worse of the time tone and the courier tone (D18). */
export function cardTone(time: Tone, courier: CourierTone | null | undefined): Tone {
  const fromCourier: Tone = courier === 'red' ? 'late' : courier === 'amber' ? 'soon' : 'ok';
  const rank: Record<Tone, number> = { ok: 0, soon: 1, late: 2 };
  return rank[fromCourier] > rank[time] ? fromCourier : time;
}

// ------------------------------------------------------------------ the card menu (2.6)

/** F7 (design 2.6): the courier items, in the overrides group, SUPPORT and ADMIN only. */
export type CourierMenuItem = 'assignCourier' | 'takeOffCourier' | 'chooseAnother' | 'findCourier';

/**
 * Which courier items a card's menu shows. KITCHEN never sees them (A40.3); the demo admin sees
 * them disabled; an Out for delivery card has none (A38.4).
 */
export function courierMenuFor(
  card: { status: string; courier?: BoardCourier | null },
  view: 'kitchen' | 'full',
): CourierMenuItem[] {
  const courier = card.courier;
  if (view !== 'full' || card.status !== 'READY' || !courier) return [];
  if (HELD.has(courier.state)) return ['takeOffCourier', 'chooseAnother'];
  const items: CourierMenuItem[] = ['assignCourier'];
  if (courier.state === 'notLooking') items.push('findCourier');
  return items;
}

/** The orders a no-courier banner speaks for (A39.1), oldest first as the board sorts them. */
export function noCourierOrders<T extends { status: string; courier?: BoardCourier | null }>(
  cards: readonly T[],
): T[] {
  return cards.filter((card) => card.status === 'READY' && card.courier?.state === 'escalated');
}

export const nobodyOnline = (cards: readonly { status: string; courier?: BoardCourier | null }[]) =>
  cards.some((card) => card.status === 'READY' && card.courier?.state === 'nobodyOnline');

// ------------------------------------------------------------------ the couriers chip (2.3)

export function couriersChipText(count: CouriersCount): { text: string; spoken: string } {
  if (count.online === 0) return { text: 'No couriers online', spoken: 'No couriers online' };
  return {
    text: `Couriers · ${count.online} online · ${count.free} free`,
    spoken: `Couriers: ${count.online} online, ${count.free} free`,
  };
}

// ------------------------------------------------------------------ the offers list (2.4.1)

export type OutcomeLook = 'accepted' | 'plain' | 'missed' | 'unseen' | 'open';

export function outcomeLook(ending: OfferEnding | 'open', words: string): OutcomeLook {
  if (ending === 'open') return 'open';
  if (ending === 'accepted') return 'accepted';
  if (ending === 'expired') return words === 'Missed' ? 'missed' : 'unseen';
  return 'plain';
}

/** "Open · 24 s left" for an open offer; the server's words otherwise. */
export function outcomeText(
  ending: OfferEnding | 'open',
  words: string,
  expiresAt: string | null,
  now: Date,
): string {
  if (ending !== 'open') return words;
  const left = offerSecondsLeft(expiresAt, now);
  return left === null ? 'Open' : `Open · ${left} s left`;
}

/** "Foodz (automatic) · Within 2 km · 1.4 km from the kitchen · Seen 7:40:13 pm". */
export function offerRowDetails(
  row: { sentBy: string; reachWords: string | null; distanceWords: string; seenAt: string | null },
  timeZone: string,
): string {
  return [
    row.sentBy,
    row.reachWords,
    row.distanceWords,
    row.seenAt ? `Seen ${clockWithSeconds(row.seenAt, timeZone)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export const offersListLabel = (orderNumber: string) => `Offers for order ${orderNumber}`;

/** The accepted courier's time: the offer's time plus the seconds it took to answer. */
export function acceptedAt(row: { at: string; outcomeWords: string }): string {
  const seconds = Number(/after (\d+) s/.exec(row.outcomeWords)?.[1] ?? 0);
  return new Date(Date.parse(row.at) + seconds * 1000).toISOString();
}

// ------------------------------------------------------------------ the assign dialog (2.7)

export const ASSIGN_COPY = {
  description: 'Choose an online courier. They get 60 seconds to accept.',
  online: 'Online couriers',
  refresh: 'Refresh list',
  loading: 'Loading couriers',
  unable: "Can't take it now",
  nobody:
    'No couriers are online right now. You can call the customer, or mark the order picked up by your own driver.',
  choose: 'Choose a courier.',
  action: 'Send offer',
  pending: 'Sending offer…',
  safe: 'Close',
  rateLimit: (minutes: number) =>
    `You've sent a lot of offers in the last hour. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`,
} as const;

export const assignTitle = (orderNumber: string) => `Assign a courier to order ${orderNumber}`;

/** The row's second line: "Bicycle · 1.4 km from the kitchen · waiting 10 min". */
export function assignRowLine(row: Pick<AssignableCourier, 'name' | 'words'>): string {
  const prefix = `${row.name} · `;
  return row.words.startsWith(prefix) ? row.words.slice(prefix.length) : row.words;
}

/** The radio's name: "Grace Okafor, bicycle, 1.4 km from the kitchen, waiting 10 minutes". */
export function assignRowSpoken(row: Pick<AssignableCourier, 'name' | 'words'>): string {
  const [vehicle, ...rest] = assignRowLine(row).split(' · ');
  const tail = rest.map((part) =>
    part.replace(/(\d+) min$/, (_, n: string) => `${n} ${n === '1' ? 'minute' : 'minutes'}`),
  );
  return [row.name, vehicle?.toLowerCase(), ...tail].filter(Boolean).join(', ');
}

export function assignTags(tags: AssignableCourier['tags'], timeZone: string): string[] {
  const range = REACHES_KM.at(-1) ?? 8;
  return [
    tags.declinedAt ? `Declined this order at ${boardClock(tags.declinedAt, timeZone)}` : null,
    tags.gaveBackAt ? `Gave back this order at ${boardClock(tags.gaveBackAt, timeZone)}` : null,
    tags.staleMinutes !== null ? `Location not shared for ${tags.staleMinutes} min` : null,
    tags.outOfRangeKm !== null
      ? `${tags.outOfRangeKm.toFixed(1)} km away, outside the ${range} km range`
      : null,
  ].filter((tag): tag is string => tag !== null);
}

export const offlineCountText = (count: number) =>
  count === 1
    ? "1 approved courier is offline and can't be assigned."
    : `${count} approved couriers are offline and can't be assigned.`;

export const offerSentAnnouncement = (shortName: string) => `Offer sent to ${shortName}.`;

/** "Grace Okafor" → "Grace O." for the board's words. */
export function shortOf(name: string): string {
  const [first = name, ...rest] = name.trim().split(/\s+/);
  const last = rest.at(-1);
  return last ? `${first} ${last.charAt(0).toUpperCase()}.` : first;
}

export const firstOf = (name: string) => name.trim().split(/\s+/)[0] ?? name;

// ------------------------------------------------------------------ taking a courier off (2.8)

export const TAKE_OFF_LABELS: Record<TakeOffReason, string> = {
  'courier-asked': 'Courier asked to give it back',
  'not-responding': "Courier isn't responding",
  'too-far': 'Courier is too far away',
  other: 'Other',
};

export const takeOffTitle = (orderNumber: string, shortName: string) =>
  `Take order ${orderNumber} off ${shortName}?`;

export function takeOffOutcome(shortName: string): string {
  const first = firstOf(shortName);
  return `We'll tell ${first} and start looking for another courier. ${first} won't be offered this order again automatically.`;
}

export const takenOffAnnouncement = (shortName: string, orderNumber: string) =>
  `${shortName} taken off order ${orderNumber}. Finding another courier.`;

export const LOOKING_AGAIN = 'Looking for a courier again.';

// ------------------------------------------------------------------ banners and notices (2.9, 2.12)

export function noCourierBannerText(
  orders: readonly { number: string }[],
  viewer: 'kitchen' | 'full',
): { text: string; action: 'assign' | 'show' | null } | null {
  const [first] = orders;
  if (!first) return null;
  if (orders.length > 1) {
    return { text: `${orders.length} ready orders have no courier.`, action: 'show' };
  }
  return viewer === 'kitchen'
    ? {
        text: `Order ${first.number} has no courier after 5 minutes. Ask support or the shift lead to assign one.`,
        action: null,
      }
    : {
        text: `Order ${first.number} has no courier after 5 minutes. Assign one, or call the customer.`,
        action: 'assign',
      };
}

export const NOBODY_ONLINE_TEXT =
  "No couriers are online. Ready orders can't go out until a courier goes online.";

export const didNotTakeNotice = (shortName: string, orderNumber: string) =>
  `${shortName} didn't take order ${orderNumber}.`;

/** A42: what changed since the version the dialog or card saw, in one sentence. */
export function deliveryChangedText(
  orderNumber: string,
  details: DispatchRefusalDetails['DELIVERY_CHANGED'],
  timeZone: string,
  fallback: string,
): string {
  const by = details.by;
  const at = boardClock(details.at, timeZone);
  if (by.kind === 'partner' && by.shortName) {
    if (details.how === 'accepted')
      return `${by.shortName} accepted order ${orderNumber} a moment ago.`;
    if (details.how === 'gave-back') return `${by.shortName} gave it back a moment ago.`;
  }
  if (by.kind === 'staff' && by.name) {
    const did =
      details.how === 'offered'
        ? 'offered it to a courier'
        : details.how === 'taken-off'
          ? 'took the courier off'
          : details.how === 'restarted'
            ? 'started looking for a courier again'
            : null;
    if (did) {
      return `Order ${orderNumber} changed a moment ago: ${by.name} ${did} at ${at}. Check it and try again.`;
    }
  }
  return fallback;
}

export function isDeliveryChangedDetails(
  value: unknown,
): value is DispatchRefusalDetails['DELIVERY_CHANGED'] {
  if (typeof value !== 'object' || value === null) return false;
  const by: unknown = Reflect.get(value, 'by');
  return (
    typeof Reflect.get(value, 'how') === 'string' &&
    typeof Reflect.get(value, 'at') === 'string' &&
    typeof by === 'object' &&
    by !== null &&
    typeof Reflect.get(by, 'kind') === 'string'
  );
}

// ------------------------------------------------------------------ F5 dialog additions (2.11)

export const moveBackCourierLine = (shortName: string) =>
  `${shortName} is assigned. They'll keep the order and be told it needs a few more minutes.`;
export const cancelCourierLine = (shortName: string) =>
  `${shortName} is on the way to pick it up. We'll tell them it's cancelled.`;
export const assignedCourierReason = (shortName: string) =>
  `Picked up by the assigned courier (${shortName})`;
export const deliveredByCourierReason = (shortName: string) =>
  `Delivered by the assigned courier (${shortName})`;
export const otherWayLine = (shortName: string) =>
  `${shortName} will be told it was handed over another way.`;
export const suspendCourierLine = (firstName: string, orderNumber: string) =>
  `${firstName} has order ${orderNumber}. Suspending gives it back to dispatch.`;

/** The courier who holds a Ready order before pickup, from its line; null otherwise. */
export function holdingCourier(courier: BoardCourier | null | undefined): string | null {
  if (!courier || !HELD.has(courier.state)) return null;
  return courier.shortName;
}
