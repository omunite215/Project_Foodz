import type {
  PartnerTrackingNotice,
  ProblemKind,
  TrackingRoute,
} from '@/server/modules/tracking/schema';
import { keepsFeeSentence } from '@/lib/partner/earnings-text';

/*
 * The courier's F8 words (design 2, "Copy"): the map's figure, the counter card, the slider,
 * Open in Maps and its warning, the code sheet, the problems, the waiting clock and the
 * endings. Figures come from the server's route; his own distance to the kitchen or the door
 * (for the 300 m checks) is the only thing measured on the phone. The customer is named by
 * her first name only, and partners only ever see "Foodz support".
 */

export const DELIVERY_COPY = {
  slide: 'Slide when you have the food',
  tapAgain: 'Tap again to confirm',
  confirming: 'Confirming pickup…',
  confirmingOffline: 'Confirming pickup… waiting for a connection',
  pickedUp: 'Picked up',
  enterCode: 'Enter delivery code',
  completeDelivery: 'Complete delivery',
  completing: 'Completing…',
  waitingConnection: 'Waiting for a connection…',
  noConnection: "You're offline, so the code wasn't sent. Try again when you're back online.",
  cantCheck: "We can't check codes right now. Call Foodz Kitchen.",
  codeLabel: 'Delivery code',
  codeName: 'Delivery code, 4 digits',
  enterAll: 'Enter all 4 digits.',
  cashTick: 'Tick this once you have the cash.',
  locked: 'Too many wrong codes. Call Foodz Kitchen so they can confirm this delivery.',
  problemTrigger: 'Problem with this delivery',
  problemLimit: "You've reported several problems. Call Foodz Kitchen.",
  tellNobody: 'Tell Foodz nobody answered',
  telling: 'Telling Foodz…',
  told: 'Foodz support has been told. Stay with the order until they call you.',
  openInMaps: 'Open in Maps',
  mapsTitle: 'Open another maps app?',
  stayInFoodz: 'Stay in Foodz',
  openMaps: 'Open Maps',
  mapFailed: 'Map unavailable right now',
  stillSharing: 'Your location is still being shared.',
  recenter: 'Recenter',
  recenterName: 'Recenter the map on you',
  backToWaiting: 'Back to waiting',
  dropoff: 'Drop-off',
  callKitchen: 'Call Foodz Kitchen',
  kitchenAddress: 'Foodz Kitchen · 88 Harbor Street',
} as const;

export const pickedUpName = (orderNumber: string) =>
  `${DELIVERY_COPY.slide}, picked up order ${orderNumber}`;

export const pickedUpAnnouncement = (orderNumber: string, customerFirst: string | null) =>
  customerFirst
    ? `Order ${orderNumber} picked up. Deliver to ${customerFirst}.`
    : `Order ${orderNumber} picked up.`;

export const counterText = (orderNumber: string) =>
  `You're at the kitchen. Show order number ${orderNumber} at the counter.`;

export const notReadyText = (orderNumber: string) =>
  `The kitchen is still preparing order ${orderNumber}.`;

export const kmText = (meters: number) => `${(Math.round(meters / 100) / 10).toFixed(1)} km`;

/** The 300 m checks (P38.3, P41.4). */
export const farTitle = (step: 'pickUp' | 'handOver', orderNumber: string) =>
  step === 'pickUp'
    ? `Picked up order ${orderNumber} anyway?`
    : `Hand over order ${orderNumber} anyway?`;
export const farDescription = (step: 'pickUp' | 'handOver', meters: number) =>
  step === 'pickUp'
    ? `You're ${kmText(meters)} from the kitchen.`
    : `You're ${kmText(meters)} from the drop-off.`;

export interface RouteFigure {
  figure: string;
  rest: string;
  spoken: string;
}

/** "4 min to the kitchen" / "4 min · 1.4 km to go" (P48.2's spoken forms too). */
/** Within this many metres of the drop-off, the figure reads "At the door". */
export const AT_DOOR_M = 50;

export function routeFigure(
  route: Pick<TrackingRoute, 'etaAt' | 'distanceM'> | null,
  toKitchen: boolean,
  serverNowMs: number,
  distanceM: number | null = route?.distanceM ?? null,
): RouteFigure | null {
  if (!route) return null;
  const minutes = Math.max(1, Math.ceil((Date.parse(route.etaAt) - serverNowMs) / 60_000));
  const spokenMinutes = `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  if (toKitchen) {
    return {
      figure: `${minutes} min`,
      rest: ' to the kitchen',
      spoken: `${spokenMinutes} to the kitchen`,
    };
  }
  // Review P2: at the door, not "1 min · 0.0 km to go".
  if (distanceM !== null && distanceM <= AT_DOOR_M) {
    return { figure: 'At the door', rest: '', spoken: 'At the door' };
  }
  const km = distanceM === null ? null : kmText(distanceM);
  return {
    figure: `${minutes} min`,
    rest: km ? ` · ${km} to go` : ' to go',
    spoken: km ? `${spokenMinutes}, ${km} to go` : `${spokenMinutes} to go`,
  };
}

/**
 * The link's name (design "Names"): it starts with the visible words, so speech input finds it
 * (WCAG 2.5.3), then says where to.
 */
export const mapsName = (customerFirst: string | null) =>
  customerFirst
    ? `Open in Maps, directions to ${customerFirst}'s door`
    : 'Open in Maps, directions to Foodz Kitchen';

/** U10, conflict 5: before pickup she has no map yet, so the words differ. */
export const mapsWarning = (afterPickup: boolean) =>
  afterPickup
    ? "While you use another maps app, Foodz can't share your location, so the customer's map pauses. Come back to Foodz when you can."
    : "While you use another maps app, Foodz can't share your location, so Foodz can't see you coming. Come back to Foodz when you can.";

// ------------------------------------------------------------------ the code sheet (2.6, 2.7)

export const codeTitle = (customerFirst: string) => `Enter ${customerFirst}'s delivery code`;
export const cashTickLabel = (amount: string) => `I collected ${amount} in cash.`;

/** P42.1, P42.2: the count is the server's; "1 try left" at the last one. */
export function wrongCodeText(customerFirst: string, triesLeft: number): string {
  const tries = `${triesLeft} ${triesLeft === 1 ? 'try' : 'tries'} left`;
  return `That code doesn't match. Ask ${customerFirst} to read it from the order page. ${tries}.`;
}

export const deliveredTitle = (orderNumber: string) => `Order ${orderNumber} delivered`;

/** The pay out of the server's "Order 1042 delivered · You earned $7.64". */
export function earnedOf(payWords: string, fallback: string): string {
  const match = /You earned (\S+)$/.exec(payWords);
  return match?.[1] ?? fallback;
}

export const deliveredAnnouncement = (orderNumber: string, pay: string) =>
  `Order ${orderNumber} delivered. You earned ${pay}.`;

// ------------------------------------------------------------------ problems (2.8, 2.9)

export const PROBLEM_ORDER: readonly ProblemKind[] = [
  'no-answer',
  'address',
  'refused',
  'cant-finish',
  'other',
];

export function problemLabel(kind: ProblemKind, customerFirst: string): string {
  switch (kind) {
    case 'no-answer':
      return `${customerFirst} isn't answering`;
    case 'address':
      return "I can't find the address";
    case 'refused':
      return `${customerFirst} refused the order`;
    case 'cant-finish':
      return "I can't finish this delivery";
    default:
      return 'Something else';
  }
}

export type NoticeTone = 'muted' | 'warning' | 'error' | 'success';

/** The outcome notice after a problem other than "isn't answering" (2.8's table). */
export function problemNotice(
  kind: Exclude<ProblemKind, 'no-answer'>,
  customerFirst: string,
): { text: string; tone: NoticeTone; callCustomer: boolean } {
  switch (kind) {
    case 'address':
      return {
        text: `Call ${customerFirst}, or call Foodz Kitchen for help.`,
        tone: 'warning',
        callCustomer: true,
      };
    case 'refused':
      return {
        text: 'Keep the food and call Foodz Kitchen.',
        tone: 'warning',
        callCustomer: false,
      };
    case 'cant-finish':
      return { text: 'Stay safe. Call Foodz Kitchen now.', tone: 'error', callCustomer: false };
    default:
      return { text: 'Call Foodz Kitchen.', tone: 'muted', callCustomer: false };
  }
}

/** "4:12 left" on the server's clock; "0:00" once it's up. */
export function clockLeft(since: string, waitSeconds: number, serverNowMs: number): string {
  const left = secondsLeft(since, waitSeconds, serverNowMs);
  const minutes = Math.floor(left / 60);
  const seconds = left % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}${left > 0 ? ' left' : ''}`;
}

/**
 * Seconds left of the wait, never more than the wait itself: a phone whose clock offset runs a
 * few seconds behind the server's would otherwise open at "5:03 left" (QA P43.2).
 */
export function secondsLeft(since: string, waitSeconds: number, serverNowMs: number): number {
  const left = Math.ceil((Date.parse(since) + waitSeconds * 1000 - serverNowMs) / 1000);
  return Math.min(waitSeconds, Math.max(0, left));
}

export const waitingTitle = (customerFirst: string) => `Waiting for ${customerFirst}`;
export const waitingTold = (customerFirst: string) =>
  `${customerFirst} has been told you're at the door.`;
export const waitingStart = (customerFirst: string) => `Waiting for ${customerFirst}. 5 minutes.`;
export const waitingOneMinute = (customerFirst: string) =>
  `1 minute left to wait for ${customerFirst}.`;
export const askedToWaitText = (customerFirst: string) =>
  `Foodz support asked you to wait 5 more minutes for ${customerFirst}.`;

// ------------------------------------------------------------------ endings (2.10, 2.11)

export function endingNotice(
  kind: Exclude<PartnerTrackingNotice, 'askedToWait'>,
  orderNumber: string,
  pay: string | null,
  /** F9 P57.3: the fee he keeps when it was cancelled after pickup. */
  feeCents: number | null = null,
): { text: string; tone: NoticeTone; bringBack: boolean } {
  switch (kind) {
    case 'confirmed':
      return {
        text: pay
          ? `Foodz support confirmed order ${orderNumber} as delivered. You earned ${pay}.`
          : `Foodz support confirmed order ${orderNumber} as delivered.`,
        tone: 'success',
        bringBack: false,
      };
    case 'cancelledBringBack':
      return {
        text: `Order ${orderNumber} was cancelled. Bring the food back to Foodz Kitchen.${
          feeCents ? ` ${keepsFeeSentence(feeCents)}` : ''
        }`,
        tone: 'warning',
        bringBack: true,
      };
    default:
      return {
        text: `Foodz marked order ${orderNumber} as delivered.`,
        tone: 'muted',
        bringBack: false,
      };
  }
}

export const holdingNotice = (orderNumber: string) =>
  `You have order ${orderNumber}. Finish order ${orderNumber} first.`;

export const locationOffTitle = (orderNumber: string, customerFirst: string) =>
  `You still have order ${orderNumber}. Turn location back on so ${customerFirst} can see you coming.`;

export const callName = (name: string, display: string) => `Call ${name}, ${display}`;

// ------------------------------------------------------------------ re-sending a code (gate S8)

/** A code that never left the phone is sent again every 2 s, at most this many times. */
export const CODE_RETRIES = 5;

/**
 * After a hand-over answer: send again only when the code never left the phone (`offline`)
 * and the retries aren't used up; anything else stops and says so.
 */
export function codeRetry(kind: string, retriesSoFar: number): 'retry' | 'stop' {
  return kind === 'offline' && retriesSoFar < CODE_RETRIES ? 'retry' : 'stop';
}
