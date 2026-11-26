import type {
  DeliveryNotice,
  OfferDetail,
  OfferEndedWhy,
  OfferGoneWhy,
} from '@/server/modules/delivery/schema';
import { endingNotice } from './delivery-text';

/*
 * The partner's offer words (F7 design 1, "Copy"): the card, the slider, the endings, the
 * notices that change what he's doing, "How offers work" and the pick-up screen. Figures and
 * place words come from the server (P20.5); these only put them into sentences. US spelling.
 */

export const OFFER_COPY = {
  newOrder: 'New order',
  offerSuffix: ' offer',
  practice: 'Practice offer',
  practiceKind: "It isn't a real order.",
  staffKind: 'Foodz support picked you for this order.',
  seconds: 'seconds',
  secondsLeft: 'seconds left',
  tenLeft: '10 seconds left',
  earn: 'You earn',
  wouldEarn: "You'd earn",
  pickup: 'Pickup',
  dropoff: 'Drop-off',
  items: 'Items',
  payment: 'Payment',
  detailsFailed: "We couldn't load this offer's details.",
  slide: 'Slide to accept',
  tapAgain: 'Tap again to accept',
  loading: 'Loading the offer…',
  accepting: 'Accepting…',
  acceptingOffline: 'Accepting… waiting for a connection',
  acceptPractice: 'Accept practice offer',
  decline: 'Decline',
  declineName: 'Decline order',
  declined: 'Offer declined',
  backToWaiting: 'Back to waiting',
  offlineExpired: "We couldn't reach Foodz in time, so the offer expired.",
  practiceAccepted:
    "Practice offer accepted. On a real order you'd now head to Foodz Kitchen to pick it up.",
  practiceTry:
    "Try an offer: send a practice offer to this phone to see how offers work. It isn't a real order.",
  practiceSend: 'Send a practice offer',
  practiceSending: 'Sending…',
  practiceLimit: "You've tried a lot of practice offers. Try again in 20 minutes.",
  offersPaused: 'Offers paused until your location is shared again.',
  howOffersWork: 'How offers work',
  soundBanner: 'Tap to turn on offer sounds',
  soundOn: 'Offer sounds on',
  offerAlerts: 'Offer alerts',
  testAlert: 'Test offer alert',
  testAlertHint: "Didn't hear it? Turn up the volume. On iPhone, also check the silent switch.",
  noVibrate: "Your phone doesn't let web apps vibrate. Keep the sound on.",
} as const;

/** The dialog's accessible name: "New order offer" or "Practice offer" (design 1.3). */
export const offerTitle = (kind: OfferDetail['kind'] | null) =>
  kind === 'practice' ? OFFER_COPY.practice : OFFER_COPY.newOrder;

/** The band's second line: staff and practice offers only. */
export function offerKindLine(kind: OfferDetail['kind'] | null): string | null {
  if (kind === 'staff') return OFFER_COPY.staffKind;
  if (kind === 'practice') return OFFER_COPY.practiceKind;
  return null;
}

export const payLabel = (kind: OfferDetail['kind'] | null) =>
  kind === 'practice' ? OFFER_COPY.wouldEarn : OFFER_COPY.earn;

/** The slider's accessible name: "Accept order, earn $7.64" (design 1.5). */
export function acceptName(detail: Pick<OfferDetail, 'kind' | 'payText'> | null): string {
  if (detail?.kind === 'practice') return OFFER_COPY.acceptPractice;
  return detail ? `Accept order, earn ${detail.payText}` : 'Accept order';
}

/**
 * The card's description for screen readers (P35.3): the server's summary, then the seconds
 * left when the card opened. "You earn $7.64, includes $5.00 tip. … 27 seconds to answer."
 */
export function offerSummary(summary: string | null, left: number): string {
  const time = `${left} ${left === 1 ? 'second' : 'seconds'} to answer.`;
  if (!summary) return `${OFFER_COPY.loading} ${time}`;
  const base = summary.trim().replace(/\.$/, '');
  return `${base}. ${time}`;
}

/**
 * Whole seconds left on the server's clock, never below zero (P21.1): a card that arrives 3 s
 * late starts at 27, and a phone clock five minutes wrong still counts correctly.
 */
export function secondsLeft(expiresAt: string, offsetMs: number, deviceNow = Date.now()): number {
  const left = Date.parse(expiresAt) - (deviceNow + offsetMs);
  return Math.max(0, Math.floor(left / 1000));
}

/** The ring's stroke offset for the seconds left out of the offer's length (design 1.4). */
export const RING_LENGTH = 2 * Math.PI * 50;
export function ringOffset(left: number, total: number): number {
  if (total <= 0) return RING_LENGTH;
  const share = Math.min(1, Math.max(0, left / total));
  return RING_LENGTH * (1 - share);
}

// ------------------------------------------------------------------ endings (design 1.7)

export type OfferNoticeTone = 'muted' | 'warning' | 'success';
export type OfferNoticeIcon = 'clock' | 'info' | 'alarm' | 'check' | 'undo';

export interface OfferNoticeWords {
  text: string;
  tone: OfferNoticeTone;
  icon: OfferNoticeIcon;
  /** F8 P44.3: "Call Foodz Kitchen" and the kitchen's address line inside the notice. */
  call?: { phone: string; address: string };
}

const MISSED: OfferNoticeWords = {
  text: 'Offer missed. The time ran out.',
  tone: 'muted',
  icon: 'clock',
};
const ORDER_CHANGED: OfferNoticeWords = {
  text: 'This offer was withdrawn because the order changed.',
  tone: 'muted',
  icon: 'info',
};
const WITHDRAWN: OfferNoticeWords = {
  text: 'This offer was withdrawn.',
  tone: 'muted',
  icon: 'info',
};
const TAKEN: OfferNoticeWords = {
  text: 'Another partner took this order.',
  tone: 'muted',
  icon: 'info',
};

/**
 * The notice for an offer that ended without his answer (`offer.ended`). Null when another
 * screen says it: a decline is only announced, and going offline shows F6's offline notice.
 */
export function endedNotice(why: OfferEndedWhy): OfferNoticeWords | null {
  switch (why) {
    case 'expired':
      return MISSED;
    case 'withdrawn-order':
      return ORDER_CHANGED;
    case 'withdrawn-staff':
      return WITHDRAWN;
    case 'taken':
      return TAKEN;
    default:
      return null;
  }
}

/** The same notices for an accept or decline the server refused with `OFFER_GONE`. */
export function goneNotice(why: OfferGoneWhy): OfferNoticeWords {
  switch (why) {
    case 'expired':
      return MISSED;
    case 'taken':
      return TAKEN;
    case 'order-changed':
      return ORDER_CHANGED;
    default:
      return WITHDRAWN;
  }
}

// ------------------------------------------------------------------ what happened to his order (P31)

export function releaseNotice(
  kind: DeliveryNotice,
  orderNumber: string,
  /** F8: the pay for "confirmed", and the kitchen for "bring it back". */
  extra: { pay?: string | null; kitchen?: { phone: string; address: string } | null } = {},
): OfferNoticeWords {
  switch (kind) {
    case 'confirmed':
    case 'cancelledBringBack':
    case 'markedDelivered': {
      const words = endingNotice(kind, orderNumber, extra.pay ?? null);
      return {
        text: words.text,
        tone: words.tone === 'error' ? 'warning' : words.tone,
        icon: kind === 'confirmed' ? 'check' : kind === 'cancelledBringBack' ? 'undo' : 'info',
        ...(words.bringBack && extra.kitchen ? { call: extra.kitchen } : {}),
      };
    }
    case 'takenOff':
      return {
        text: `Foodz support took order ${orderNumber} off you. You don't need to pick it up.`,
        tone: 'muted',
        icon: 'info',
      };
    case 'cancelled':
      return {
        text: `Order ${orderNumber} was cancelled. You don't need to pick it up.`,
        tone: 'muted',
        icon: 'info',
      };
    case 'handedOver':
      return {
        text: `Order ${orderNumber} was handed over another way. You don't need to pick it up.`,
        tone: 'muted',
        icon: 'info',
      };
    default:
      return {
        text: `The kitchen needs a few more minutes for order ${orderNumber}. Keep heading over.`,
        tone: 'muted',
        icon: 'clock',
      };
  }
}

export const yoursText = (orderNumber: string) => `Order ${orderNumber} is yours`;
export const gaveBackText = (orderNumber: string) => `Order ${orderNumber} given back.`;

/** P25.1: shown at one miss before the limit. */
export function missedNotice(missedInRow: number, missLimit: number): OfferNoticeWords | null {
  if (missLimit < 2 || missedInRow !== missLimit - 1) return null;
  return {
    text: `You've missed ${missedInRow} offers in a row. If you miss the next one, we'll take you offline so other partners get orders.`,
    tone: 'warning',
    icon: 'alarm',
  };
}

// ------------------------------------------------------------------ "How offers work" (P27.1)

/** "within 2 km, then 4 km, then 8 km". */
function reachWords(reaches: readonly number[]): string {
  const [first, ...rest] = reaches;
  if (first === undefined) return 'nearby';
  return [`within ${first} km`, ...rest.map((km) => `${km} km`)].join(', then ');
}

export function howOffersWorkItems(numbers: {
  reachesKm: readonly number[];
  offerSeconds: number;
  missLimit: number;
}): { key: 'route' | 'wait' | 'timer' | 'alarm' | 'phone'; text: string }[] {
  return [
    {
      key: 'route',
      text: `Offers go to partners near Foodz Kitchen first: ${reachWords(numbers.reachesKm)}.`,
    },
    {
      key: 'wait',
      text: 'Among partners that close, whoever has waited longest since their last order gets the next offer.',
    },
    {
      key: 'timer',
      text: `You have ${numbers.offerSeconds} seconds to answer. Declining is fine and doesn't count against you.`,
    },
    {
      key: 'alarm',
      text: `If you miss ${numbers.missLimit} offers in a row, we take you offline so other partners get orders.`,
    },
    {
      key: 'phone',
      text: 'You get offers only while Foodz is open on your screen and sharing your location.',
    },
  ];
}

// ------------------------------------------------------------------ the pick-up screen (P29)

export const pickUpTitle = (orderNumber: string) => `Pick up order ${orderNumber}`;
export const deliverTitle = (orderNumber: string) => `Deliver order ${orderNumber}`;

/**
 * "Foodz Kitchen · 88 Harbor Street" (design 1.12): the partner app always calls the one
 * kitchen "Foodz Kitchen"; the street is enough to ride to, the maps app has the rest.
 */
export const kitchenLine = (addressText: string) =>
  `Foodz Kitchen · ${addressText.split(',')[0]?.trim() || addressText}`;

/** "Then: Boston 02109 · 1.3 km" from the server, shown under its own "Then" label. */
export const withoutThen = (text: string) => text.replace(/^Then:\s*/, '');

/** "$7.64 · includes $5.00 tip". */
export const earnWords = (payText: string, tipText: string | null) =>
  tipText ? `${payText} · ${tipText}` : payText;

/** The pick-up screen's payment line (design 1.12): "… collect $58.97 at the door." */
export function pickUpPaymentWords(payment: { kind: 'cash' | 'card'; text: string }): string {
  if (payment.kind === 'card') return payment.text;
  return `${payment.text.replace(/\.$/, '')} at the door.`;
}

/** The interim screen's line (design 1.13): "Collect $58.97 in cash." */
export function deliverPaymentWords(payment: { kind: 'cash' | 'card'; text: string }): string {
  if (payment.kind === 'card') return payment.text;
  const amount = /\$[\d,]+(?:\.\d{2})?/.exec(payment.text)?.[0];
  return amount ? `Collect ${amount} in cash.` : payment.text;
}

/** "(617) 555-0142" from "+16175550142"; anything else as given. */
export function phoneDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (national.length !== 10) return phone;
  return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
}

/** `tel:+16175550142`. */
export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

const coordinate = (value: number) => String(Number(value.toFixed(6)));

/**
 * Directions to a point in the phone's maps app (design 1.12, D14): Apple Maps on iPhone and
 * iPad, Google Maps everywhere else, cycling directions for a bicycle.
 */
export function mapsHref(
  point: { lat: number; lng: number },
  options: { apple: boolean; bicycle: boolean },
): string {
  const at = `${coordinate(point.lat)},${coordinate(point.lng)}`;
  if (options.apple) return `https://maps.apple.com/?daddr=${at}&dirflg=d`;
  const mode = options.bicycle ? 'bicycling' : 'driving';
  return `https://www.google.com/maps/dir/?api=1&destination=${at}&travelmode=${mode}`;
}

/** iPhone and iPad, including iPadOS that reports itself as a Mac with touch. */
export function isApplePhone(userAgent: string, maxTouchPoints = 0): boolean {
  if (/iPhone|iPad|iPod/.test(userAgent)) return true;
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

// ------------------------------------------------------------------ giving back (P30)

export const GIVE_BACK_LABELS = {
  vehicle: 'Vehicle problem',
  emergency: 'Accident or emergency',
  'too-far': 'Too far for me',
  other: 'Other',
} as const;

export const giveBackTitle = (orderNumber: string) => `Give back order ${orderNumber}?`;
export const GIVE_BACK_COPY = {
  legend: 'Why?',
  chooseReason: 'Choose a reason.',
  line: "We'll offer it to another partner right away.",
  action: 'Give back',
  pending: 'Giving back…',
  keep: 'Keep the order',
  limit: "You've given back several orders. Call Foodz Kitchen if something's wrong.",
  trigger: "Can't do this delivery",
} as const;
export const alreadyPickedUpText = (orderNumber: string) =>
  `Order ${orderNumber} has already been picked up.`;

/** The go-offline and sign-out dialogs while he holds an order (design 1.14). */
export function leavingWords(orderNumber: string, how: 'offline' | 'signOut') {
  return {
    title: `You have order ${orderNumber}`,
    description:
      how === 'offline'
        ? `You're picking up order ${orderNumber}. Going offline gives it back so another partner can take it.`
        : `You're picking up order ${orderNumber}. Signing out gives it back so another partner can take it.`,
    keep: 'Keep the order',
    action: how === 'offline' ? 'Give back and go offline' : 'Give back and sign out',
    pending: 'Giving back…',
  };
}
