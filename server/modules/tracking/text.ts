import { formatPrice } from '@/lib/format';
import type { AttentionKind, DeliveryLine, MapState, ProblemKind } from './schema';

/*
 * Ready-made words for the board's Out-for-delivery line and banners, the live map and the
 * partner's endings (F8 design 3.3 to 3.9, 2.7, 2.10). Times in the store's zone are formatted by
 * the caller; staff see "Luis M." on cards and full names in the detail and the map panel.
 */

const PROBLEM_WORDS: Record<ProblemKind, string> = {
  'no-answer': "isn't answering",
  address: "can't find the address",
  refused: 'refused the order',
  'cant-finish': "can't finish this delivery",
  other: 'something else',
};

const ICONS: Record<DeliveryLine['state'], DeliveryLine['icon']> = {
  onTheWay: 'truck',
  almost: 'pin',
  noLocation: 'signal-off',
  noAnswer: 'door',
  locked: 'lock',
  problem: 'alert',
};

const km = (meters: number) => `${(Math.round(meters / 100) / 10).toFixed(1)} km`;

/** A48.1: "Luis M. · 0.9 km to go · arriving 7:46 pm" and the other six. */
export function deliveryLineWords(facts: {
  state: DeliveryLine['state'];
  tone: DeliveryLine['tone'];
  courierShort: string;
  customerFirst: string;
  distanceToDoorM: number | null;
  arrivalClock: string | null;
  silentMinutes: number;
  waitedMinutes: number;
  problem: ProblemKind | null;
}): DeliveryLine {
  const who = facts.courierShort;
  let words: string;
  switch (facts.state) {
    case 'almost':
      words = `${who} · arriving now`;
      break;
    case 'noLocation':
      words = `${who} · no location for ${facts.silentMinutes} min`;
      break;
    case 'noAnswer':
      words = `${who} · ${facts.customerFirst} isn't answering · ${facts.waitedMinutes} min`;
      break;
    case 'locked':
      words = `${who} · code locked`;
      break;
    case 'problem':
      words = `${who} · problem: ${PROBLEM_WORDS[facts.problem ?? 'other']}`;
      break;
    default:
      words = [
        who,
        facts.distanceToDoorM === null ? null : `${km(facts.distanceToDoorM)} to go`,
        facts.arrivalClock ? `arriving ${facts.arrivalClock}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
  }
  return {
    state: facts.state,
    tone: facts.tone,
    words,
    icon: ICONS[facts.state],
    spoken: words.replaceAll(' · ', ', '),
  };
}

/** A49.1, A49.2: the board banner for one stuck delivery. */
export function attentionWords(facts: {
  kind: AttentionKind;
  orderNumber: string;
  courierFirst: string;
  customerFirst: string;
  minutes: number;
  problem: ProblemKind | null;
}): string {
  const order = `Order ${facts.orderNumber}`;
  switch (facts.kind) {
    case 'no-answer':
      return `${order}: ${facts.customerFirst} isn't answering. ${facts.courierFirst} has waited ${facts.minutes} ${facts.minutes === 1 ? 'minute' : 'minutes'}.`;
    case 'locked':
      return `${order}: the delivery code is locked after 5 wrong tries.`;
    case 'problem':
      return `${order}: ${facts.courierFirst} ${PROBLEM_WORDS[facts.problem ?? 'other']}.`;
    default:
      return `${order}: no location from ${facts.courierFirst} for ${facts.minutes} minutes. Call him.`;
  }
}

/** A49.3. */
export const attentionStackWords = (count: number) => `${count} deliveries need attention.`;

/** A46.2: the map's label for a courier. */
export function mapStateWords(
  state: MapState,
  orderNumber: string | null,
  silentMinutes: number | null,
) {
  const order = orderNumber ? ` · ${orderNumber}` : '';
  if (silentMinutes !== null && silentMinutes >= 2) return `No location · ${silentMinutes} min`;
  switch (state) {
    case 'free':
      return 'Free';
    case 'offered':
      return `Offered${order.replace(' · ', ' ')}`;
    case 'toKitchen':
      return `To kitchen${order}`;
    case 'atKitchen':
      return `At kitchen${order}`;
    case 'delivering':
      return `Delivering${order.replace(' · ', ' ')}`;
    case 'noAnswer':
      return `No answer${order}`;
    case 'locked':
      return `Code locked${order}`;
    default:
      return `Problem${order}`;
  }
}

/** P41.3: "Order 1042 delivered · You earned $7.64". */
export const deliveredWords = (orderNumber: string, payCents: number) =>
  `Order ${orderNumber} delivered · You earned ${formatPrice(payCents)}`;

/** P44.3, without a staff name. */
export function partnerNoticeWords(
  kind: 'askedToWait' | 'confirmed' | 'cancelledBringBack' | 'markedDelivered',
  orderNumber: string,
  customerFirst: string,
  payCents: number,
): string {
  switch (kind) {
    case 'askedToWait':
      return `Foodz support asked you to wait 5 more minutes for ${customerFirst}.`;
    case 'confirmed':
      return `Foodz support confirmed order ${orderNumber} as delivered. You earned ${formatPrice(payCents)}.`;
    case 'cancelledBringBack':
      return `Order ${orderNumber} was cancelled. Bring the food back to Foodz Kitchen.`;
    default:
      return `Foodz marked order ${orderNumber} as delivered.`;
  }
}

/** S4, U18: the two new in-app notifications. Neither ever carries the code. */
export const customerNotices = {
  almostHere: (orderNumber: string, courierFirst: string, minutes: number) => ({
    type: 'order.almost-here' as const,
    title: `Order ${orderNumber} is almost here`,
    body: `${courierFirst} is about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} away. Your delivery code is on your order page.`,
  }),
  atDoor: (courierFirst: string, phoneDisplay: string) => ({
    type: 'order.courier-at-door' as const,
    title: 'Your courier is at the door',
    body: `${courierFirst} is at your door and couldn't reach you. Come to the door with your code, or call us on ${phoneDisplay}.`,
  }),
};
