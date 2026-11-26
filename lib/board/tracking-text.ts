import type { BoardCourier } from '@/server/modules/delivery/schema';
import type {
  AttentionItem,
  ConfirmReason,
  DeliveryLine,
  MapState,
  OpsMapCourier,
  OpsMapDelivery,
} from '@/server/modules/tracking/schema';
import type { Tone } from '@/server/modules/board/timing';

/*
 * The staff words for live tracking (F8 design 3.3 to 3.14): the Out-for-delivery line's spoken
 * form and tone, the stuck-delivery banners, the actions on a stuck delivery, the live map's
 * sorting and labels, and the detail's steps. The server resolves states and their words;
 * these add the spoken prefix, the sentences around them and the order things show in. Staff
 * copy never says "he" or "she"; names keep their capitals.
 */

// ------------------------------------------------------------------ the line (3.8)

/** "Courier: Luis M., 0.9 km to go, arriving 7:46 pm" (built from parts, F7 review S4). */
export const deliveryLineSpoken = (line: Pick<DeliveryLine, 'spoken'>) => `Courier: ${line.spoken}`;

/** The card's border takes the worst of time, courier and lateness (A48.2, F7 D18). */
export function deliveryTone(time: Tone, line: DeliveryLine | null | undefined): Tone {
  if (!line) return time;
  if (line.late || line.tone === 'red') return 'late';
  if (line.tone === 'amber') return time === 'late' ? 'late' : 'soon';
  return time;
}

// ------------------------------------------------------------------ stuck deliveries (3.9, 3.10)

export type StuckAction = 'confirmHandover' | 'askToWait' | 'cancelUnreachable';

/**
 * A50: offered only after a code lock or 5 minutes of "isn't answering" (red from 5 min); a
 * reported problem may be cancelled and brought back. SUPPORT and ADMIN; never the kitchen.
 */
export function stuckActionsFor(
  card: { status: string; delivery?: DeliveryLine | null; courier?: BoardCourier | null },
  view: 'kitchen' | 'full',
): StuckAction[] {
  const line = card.delivery;
  if (view !== 'full' || card.status !== 'PICKED_UP' || !line) return [];
  if (line.state === 'locked') return ['confirmHandover', 'cancelUnreachable'];
  if ((line.state === 'noAnswer' || line.state === 'askedToWait') && line.tone === 'red') {
    return ['confirmHandover', 'askToWait', 'cancelUnreachable'];
  }
  if (line.state === 'problem') return ['cancelUnreachable'];
  return [];
}

export const STUCK_LABELS: Record<StuckAction, (courierFirst: string) => string> = {
  confirmHandover: () => 'Confirm hand-over',
  askToWait: (courierFirst) => `Ask ${courierFirst} to wait 5 more minutes`,
  cancelUnreachable: () => 'Cancel and bring it back',
};

/** "Luis M." → "Luis" for sentences about the courier. */
export const firstOfShort = (shortName: string | null | undefined) =>
  shortName?.split(' ')[0] ?? 'the courier';

export type BannerLook = {
  variant: 'warning' | 'error';
  icon: 'door' | 'lock' | 'alert' | 'signal';
};

/** One stuck delivery's banner look (3.9's table): amber turns red from 5 minutes. */
export function attentionLook(item: Pick<AttentionItem, 'kind' | 'minutes'>): BannerLook {
  switch (item.kind) {
    case 'no-answer':
      return { variant: item.minutes >= 5 ? 'error' : 'warning', icon: 'door' };
    case 'locked':
      return { variant: 'error', icon: 'lock' };
    case 'problem':
      return { variant: 'warning', icon: 'alert' };
    default:
      return { variant: 'error', icon: 'signal' };
  }
}

const KIND_WORDS: Record<AttentionItem['kind'], string> = {
  'no-answer': "isn't answering",
  locked: 'code locked',
  problem: 'problem reported',
  'no-location': 'no location',
};

/** A49.3: the stacked banner's list line, "Order 1042 · Priya isn't answering · 6 min". */
export function attentionListLine(item: AttentionItem): string {
  const minutes = `${item.minutes} min`;
  const what =
    item.kind === 'no-answer' && item.customerFirst
      ? `${item.customerFirst} ${KIND_WORDS[item.kind]}`
      : KIND_WORDS[item.kind];
  return `Order ${item.orderNumber} · ${what} · ${minutes}`;
}

export const attentionStackText = (count: number) => `${count} deliveries need attention.`;
export const andMoreText = (count: number) => `and ${count} more`;

/** The ids a chime is played for once each (A49.1). */
export const attentionKey = (item: Pick<AttentionItem, 'orderId' | 'kind'>) =>
  `${item.orderId}:${item.kind}`;

// ------------------------------------------------------------------ the A50 dialogs

export const CONFIRM_REASON_LABELS: Record<ConfirmReason, string> = {
  'customer-confirmed': 'Customer confirmed by phone',
  'left-as-asked': 'Left as the customer asked',
  'code-checked': 'Code checked another way',
  other: 'Other',
};

export const confirmTitle = (orderNumber: string) => `Confirm hand-over of order ${orderNumber}?`;
export const confirmOutcome = (
  orderNumber: string,
  courierFirst: string,
  customerFirst: string | null = null,
) =>
  `Order ${orderNumber} will be marked delivered. We'll tell ${courierFirst} and ${customerFirst ?? 'the customer'}.`;
export const confirmedAnnouncement = (orderNumber: string) =>
  `Order ${orderNumber} marked delivered.`;
export const askedToWaitNotice = (courierShort: string, customerFirst: string | null) =>
  customerFirst
    ? `Asked ${courierShort} to wait 5 more minutes for ${customerFirst}.`
    : `Asked ${courierShort} to wait 5 more minutes.`;
export const bringBackTitle = (orderNumber: string) =>
  `Cancel order ${orderNumber} and bring it back?`;
export const bringBackOutcome = (courierFirst: string) =>
  `We'll tell ${courierFirst} to bring the food back to Foodz Kitchen.`;
export const UNREACHABLE_REASON = "Customer couldn't be reached";

// ------------------------------------------------------------------ the live map (3.2 to 3.7)

/** Couriers sorted by what needs staff first (3.4), then by name. */
const STATE_ORDER: Record<MapState, number> = {
  noAnswer: 0,
  locked: 1,
  problem: 1,
  delivering: 3,
  toKitchen: 4,
  atKitchen: 5,
  offered: 6,
  free: 7,
};

export function sortCouriers<T extends Pick<OpsMapCourier, 'state' | 'freshness' | 'fullName'>>(
  couriers: readonly T[],
): T[] {
  const rank = (courier: T) => {
    const stale = courier.freshness === 'stale' || courier.freshness === 'red';
    if (stale && STATE_ORDER[courier.state] > 1) return 2;
    return STATE_ORDER[courier.state];
  };
  return couriers.toSorted(
    (a, b) => rank(a) - rank(b) || a.fullName.localeCompare(b.fullName, 'en-US'),
  );
}

/** D30: the latest against the promise first, then by estimate. */
export function sortDeliveries<T extends Pick<OpsMapDelivery, 'lateMinutes' | 'etaAt' | 'number'>>(
  deliveries: readonly T[],
): T[] {
  return deliveries.toSorted((a, b) => {
    const late = (b.lateMinutes ?? 0) - (a.lateMinutes ?? 0);
    if (late !== 0) return late;
    const eta =
      (a.etaAt ? Date.parse(a.etaAt) : Infinity) - (b.etaAt ? Date.parse(b.etaAt) : Infinity);
    return eta || a.number.localeCompare(b.number);
  });
}

export const lateChip = (lateMinutes: number | null) =>
  lateMinutes && lateMinutes > 0 ? `${lateMinutes} min late` : 'On time';

/** The marker's label: "Luis M. · Delivering 1042". */
export const mapLabel = (courier: Pick<OpsMapCourier, 'shortName' | 'words'>) =>
  `${courier.shortName} · ${courier.words}`;

/** "Ready 6 min" for an order waiting for a courier. */
export function readyFor(readyAt: string, serverNowMs: number): string {
  const minutes = Math.max(0, Math.floor((serverNowMs - Date.parse(readyAt)) / 60_000));
  return `Ready ${minutes} min`;
}

export const offerSentAnnouncement = (shortName: string) => `Offer sent to ${shortName}.`;

export const DEMO_COPY = {
  run: 'Run a demo delivery',
  starting: 'Starting…',
  readOnly: 'Read-only in the demo',
};

export function demoRunningText(orderNumber: string | null, endsAt: string, serverNowMs: number) {
  const minutes = Math.max(1, Math.ceil((Date.parse(endsAt) - serverNowMs) / 60_000));
  const order = orderNumber ? ` · order ${orderNumber}` : '';
  return `Demo delivery running${order} · ${minutes} min left`;
}

export const demoBusyText = (endsAt: string, serverNowMs: number) => {
  const minutes = Math.max(1, Math.ceil((Date.parse(endsAt) - serverNowMs) / 60_000));
  return `A demo delivery is already running · ${minutes} min left`;
};

export const demoLimitText = (nextAtClock: string) =>
  `6 demo deliveries have run in the last hour. Try again at ${nextAtClock}.`;

/** The A53 steps: "Accepted 7:40 pm" · "At the kitchen 7:41 pm" · … (later ones aren't shown). */
export function stepsOf(
  steps: {
    assignedAt: string | null;
    atKitchenAt: string | null;
    pickedUpAt: string | null;
    deliveredAt: string | null;
  },
  clock: (iso: string) => string,
): string[] {
  const parts: [string, string | null][] = [
    ['Accepted', steps.assignedAt],
    ['At the kitchen', steps.atKitchenAt],
    ['Picked up', steps.pickedUpAt],
    ['Delivered', steps.deliveredAt],
  ];
  return parts.flatMap(([label, at]) => (at ? [`${label} ${clock(at)}`] : []));
}
