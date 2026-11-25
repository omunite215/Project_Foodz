import { atKitchenLine } from '@/lib/order-tracking';
import type { OrderView } from '@/server/modules/orders/schema';
import type {
  ArrivalWindow,
  ReorderLeftOut,
  CancellationNotice,
  CustomerCancelLine,
  CustomerTimelineEntry,
  OrderStep,
  StepKey,
} from '@/server/modules/orders/progress-schema';
import { clockAt } from '@/server/modules/orders/text';
import { formatPrice } from './format';
import { longDate, orderDateText } from './order-text';

/*
 * The customer's live order in words (F5 design 6): the hero per step, the stepper, the
 * arrival lines, the cancellation card, the timeline and the tab title. Pure functions over the
 * server's `OrderView.progress`, so the server's HTML, the browser and the tests agree. Never a
 * staff name, role, note or reason code (S5.6).
 */

export type ProgressStep = 'placed' | 'accepted' | 'preparing' | 'ready' | 'pickedUp' | 'delivered';

/** The step the order is at, from its status; null when there is no stepper (S1.2). */
export function currentStep(view: Pick<OrderView, 'status'>): ProgressStep | null {
  switch (view.status) {
    case 'PLACED':
      return 'placed';
    case 'ACCEPTED':
      return 'accepted';
    case 'PREPARING':
      return 'preparing';
    case 'READY':
      return 'ready';
    case 'PICKED_UP':
      return 'pickedUp';
    case 'DELIVERED':
      return 'delivered';
    default:
      return null;
  }
}

/** The customer's words (decision 23): "Cooking", never "Preparing"; "Collected" for U23. */
export const STEP_WORDS: Record<StepKey, string> = {
  placed: 'Placed',
  accepted: 'Accepted',
  preparing: 'Cooking',
  ready: 'Ready',
  pickedUp: 'On its way',
  delivered: 'Delivered',
};

export const stepWord = (key: StepKey, collected = false) =>
  key === 'pickedUp' && collected ? 'Collected' : STEP_WORDS[key];

/** Whether the order picked up was collected by the customer (U23). */
export const isCollected = (view: Pick<OrderView, 'progress'>) =>
  Boolean(view.progress.steps?.find((step) => step.key === 'pickedUp')?.collected);

/** A step's time: "7:27 pm", or "Thu, Nov 19 · 7:31 pm" on another day (S1.4). */
export function stepTime(
  at: string,
  now: Date,
  timeZone: string,
): { date: string | null; clock: string } {
  const clock = clockAt(at, timeZone);
  const dayOf = (instant: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' }).format(instant);
  if (dayOf(new Date(at)) === dayOf(now)) return { date: null, clock };
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(at));
  return { date, clock };
}

/** "Accepted, done, 7:27 pm" / "Cooking, now" / "Ready, not yet" (S8.3). */
export function stepSpoken(step: OrderStep, now: Date, timeZone: string): string {
  const word = stepWord(step.key, step.collected);
  if (step.state === 'upcoming') return `${word}, not yet`;
  const time = step.at ? stepTime(step.at, now, timeZone) : null;
  const when = time ? `, ${time.date ? `${time.date}, ` : ''}${time.clock}` : '';
  return step.state === 'current' ? `${word}, now${when}` : `${word}, done${when}`;
}

// ------------------------------------------------------------------ hero (design 6.3)

export const STEP_HEADINGS: Record<ProgressStep, string> = {
  placed: 'Order placed',
  accepted: 'Order accepted',
  preparing: 'Cooking your order',
  ready: 'Your food is ready',
  pickedUp: 'On its way',
  delivered: 'Delivered',
};

export function stepHeading(step: ProgressStep, collected: boolean): string {
  return step === 'pickedUp' && collected ? 'Order collected' : STEP_HEADINGS[step];
}

/** The line under the h1 for an order in progress or delivered (design 6.3). */
export function stepLine(view: OrderView, step: ProgressStep, collected: boolean): string {
  const tz = view.store.timeZone;
  switch (step) {
    case 'placed':
      if (view.progress.placedWaiting === '15') {
        return `This is taking longer than usual. Call us on ${view.store.phone}, or cancel the order if you'd rather not wait.`;
      }
      if (view.progress.placedWaiting === '5') {
        return 'Still waiting for the kitchen to accept it. You can cancel until they do.';
      }
      return 'Waiting for the kitchen to accept it. You can cancel until they do.';
    case 'accepted':
      return 'The kitchen has your order and will start cooking soon.';
    case 'preparing':
      return 'The kitchen is cooking your food now.';
    case 'ready':
      return courierReadyLine(view) ?? "It's packed and waiting for the courier.";
    case 'pickedUp':
      if (collected) return 'Your order has been handed over.';
      return courierOnItsWayLine(view) ?? 'Your order has left the kitchen.';
    case 'delivered':
    default: {
      const at = view.progress.deliveredAt;
      if (!at) return 'Enjoy your meal.';
      const when = stepTime(at, new Date(view.progress.asOf), tz);
      return when.date
        ? `Delivered on ${when.date} at ${when.clock}. Enjoy your meal.`
        : `Delivered at ${when.clock}. Enjoy your meal.`;
    }
  }
}

// ------------------------------------------------------------------ the courier (F7 design 3)

const FINDING = "It's packed. We're finding a courier to bring it to you.";
const SLOW =
  "It's packed, but finding a courier is taking longer than usual. We're on it and will update this page.";

/**
 * The line under the h1 while the order is ready (F7 S1 to S3). Once the arrival window has
 * passed, F5's arrival note carries the apology, so the hero goes back to the plain finding
 * line (D27). Null without the courier view (older answers): F5's line stands.
 */
export function courierReadyLine(view: Pick<OrderView, 'progress'>): string | null {
  const dispatch = view.progress.dispatch;
  if (!dispatch) return null;
  switch (dispatch.state) {
    case 'searching':
      return FINDING;
    case 'slow':
      return view.progress.arrival?.kind === 'pastDue' ? FINDING : SLOW;
    case 'assigned':
      if (!dispatch.courier) return FINDING;
      // F8 U1: within 100 m of the kitchen, before the slide.
      if (view.progress.tracking?.stage === 'atKitchen') {
        return atKitchenLine(dispatch.courier.firstName);
      }
      return `It's packed. ${dispatch.courier.firstName} is on the way to pick it up.`;
    default:
      return null;
  }
}

/** "Luis is bringing your order." when the assigned courier picked it up (F7 S2). */
export function courierOnItsWayLine(view: Pick<OrderView, 'progress'>): string | null {
  const dispatch = view.progress.dispatch;
  if (dispatch?.state !== 'pickedUp' || !dispatch.courier) return null;
  return `${dispatch.courier.firstName} is bringing your order.`;
}

/** "Delivered by Luis." on its own line after the delivered line (F7 design 3.1). */
export function deliveredByLine(view: Pick<OrderView, 'progress'>): string | null {
  const dispatch = view.progress.dispatch;
  if (dispatch?.state !== 'delivered') return null;
  // After delivery the server names the courier only (security S8).
  const firstName = dispatch.deliveredBy?.firstName ?? dispatch.courier?.firstName;
  return firstName ? `Delivered by ${firstName}.` : null;
}

/**
 * The timeline's courier entry (F7 S2.3, design 3.4): the current courier and when they
 * accepted. It stays once the order is picked up and delivered: it's history. Without a
 * vehicle after delivery (S8), the disc shows a plain courier mark.
 */
export function courierTimelineEntry(
  view: Pick<OrderView, 'progress'>,
): { firstName: string; vehicleWords: string | null; at: string | null } | null {
  const dispatch = view.progress.dispatch;
  if (!dispatch) return null;
  const at = dispatch.assignedAt ?? null;
  if ((dispatch.state === 'assigned' || dispatch.state === 'pickedUp') && dispatch.courier) {
    return {
      firstName: dispatch.courier.firstName,
      vehicleWords: dispatch.courier.vehicleWords,
      at,
    };
  }
  if (dispatch.state === 'delivered') {
    const firstName = dispatch.deliveredBy?.firstName ?? dispatch.courier?.firstName;
    return firstName
      ? { firstName, vehicleWords: dispatch.courier?.vehicleWords ?? null, at }
      : null;
  }
  return null;
}

/** The changed notice shows until the order is picked up (design 3.3, amended after review). */
export const courierChangedShown = (view: Pick<OrderView, 'progress'>) =>
  Boolean(view.progress.dispatch?.changed && view.progress.dispatch.state === 'assigned');

/** The courier block shows from acceptance until delivery (F7 S2.1). */
export function courierShown(view: Pick<OrderView, 'progress'>) {
  const dispatch = view.progress.dispatch;
  if (!dispatch?.courier) return null;
  return dispatch.state === 'assigned' || dispatch.state === 'pickedUp' ? dispatch.courier : null;
}

/** "Your courier changed. Grace is now on the way to pick it up." (F7 S4.2). */
export const courierChangedText = (firstName: string) =>
  `Your courier changed. ${firstName} is now on the way to pick it up.`;

/** The timeline entry for the current courier only (F7 S2.3). */
export const courierTimelineText = (firstName: string) =>
  `${firstName} is on the way to the kitchen`;

/** "Scooter · 7KT 342" read aloud: "Scooter, plate 7KT 342". */
export function vehicleSpokenWords(vehicleWords: string): string {
  const [vehicle = vehicleWords, plate] = vehicleWords.split(' · ');
  return plate ? `${vehicle}, plate ${plate}` : vehicle;
}

/** "4.6 · 31 ratings" and "Rated 4.6 from 31 ratings"; null with no rating (never "0" or "New"). */
export function ratingWords(rating: { average: number; count: number } | null) {
  if (!rating || rating.count <= 0) return null;
  const average = rating.average.toFixed(1);
  const ratings = `${rating.count} ${rating.count === 1 ? 'rating' : 'ratings'}`;
  return { text: `${average} · ${ratings}`, spoken: `Rated ${average} from ${ratings}` };
}

/** "Order 1042: Cooking. The kitchen is cooking your food now." (S8.1). */
export function statusAnnouncement(view: OrderView): string | null {
  const step = currentStep(view);
  if (!step) return null;
  const collected = isCollected(view);
  return `Order ${view.number}: ${stepWord(step, collected)}. ${stepLine(view, step, collected)}`;
}

/** "Cooking · Order 1042" while in progress; "Order 1042" when finished (design 6.12). */
export function orderTabTitle(view: OrderView): string {
  const step = currentStep(view);
  if (!step || step === 'delivered') return `Order ${view.number}`;
  return `${stepWord(step, isCollected(view))} · Order ${view.number}`;
}

// ------------------------------------------------------------------ arrival (design 6.5)

export interface ArrivalText {
  tone: 'ok' | 'late' | 'done';
  headline: string;
  spoken: string;
  /** The amber note box, at most one. */
  note: { text: string; phone: boolean } | null;
}

/** "3:00 am": the minutes even on the hour, so a window reads "3:00–3:10 am". */
function clockWithMinutes(iso: string, timeZone: string): string {
  const clock = clockAt(iso, timeZone);
  return clock.includes(':') ? clock : clock.replace(' ', ':00 ');
}

function range(from: string, to: string, timeZone: string) {
  const onTheHour = !clockAt(from, timeZone).includes(':') && !clockAt(to, timeZone).includes(':');
  const clock = onTheHour ? clockAt : clockWithMinutes;
  const start = clock(from, timeZone);
  const end = clock(to, timeZone);
  const same = start.slice(-2) === end.slice(-2);
  return {
    text: same ? `${start.slice(0, -3)}–${end}` : `${start}–${end}`,
    spoken: same ? `${start.slice(0, -3)} to ${end}` : `${start} to ${end}`,
  };
}

export function arrivalText(
  arrival: ArrivalWindow | null,
  deliveredAt: string | null,
  timeZone: string,
  /** The server's clock (`progress.asOf`): another day's delivery carries its date (S1.4). */
  now: string | Date = new Date(),
): ArrivalText | null {
  if (deliveredAt) {
    const when = stepTime(deliveredAt, new Date(now), timeZone);
    const text = when.date
      ? `Delivered ${when.date} at ${when.clock}`
      : `Delivered at ${when.clock}`;
    return { tone: 'done', headline: text, spoken: text, note: null };
  }
  if (!arrival) return null;
  if (arrival.kind === 'pastDue') {
    const text = `Due by ${clockAt(arrival.to, timeZone)}`;
    return {
      tone: 'late',
      headline: text,
      spoken: text,
      note: {
        text: "Your order is later than we said, sorry. Call us on {phone} if you'd like to check on it.",
        phone: true,
      },
    };
  }
  const window = range(arrival.from, arrival.to, timeZone);
  if (arrival.kind === 'moved') {
    return {
      tone: 'ok',
      headline: `Now arriving about ${window.text}`,
      spoken: `Now arriving about ${window.spoken}`,
      note:
        arrival.lateMinutes !== null
          ? {
              text: `Running about ${arrival.lateMinutes} minutes late. Sorry for the wait.`,
              phone: false,
            }
          : null,
    };
  }
  return {
    tone: 'ok',
    headline: `Arriving about ${window.text}`,
    spoken: `Arriving about ${window.spoken}`,
    note: arrival.behind
      ? {
          text: "The kitchen is running a little behind. We'll update your arrival time as soon as your food is ready.",
          phone: false,
        }
      : null,
  };
}

export const acceptedCancelSentence = (phone: string) =>
  `The kitchen has accepted your order, so it can't be cancelled here. Need to change something? Call us on ${phone}.`;

// ------------------------------------------------------------------ cancellation (design 6.8)

const joinDishes = (dishes: readonly string[]) =>
  dishes.length <= 1
    ? (dishes[0] ?? 'a dish')
    : `${dishes.slice(0, -1).join(', ')} and ${dishes.at(-1)}`;

/** "Sorry, we had to cancel order 1046." / "Order 1050 is cancelled." */
export const cancellationOpener = (number: string, notice: CancellationNotice) =>
  notice.opener === 'plain'
    ? `Order ${number} is cancelled.`
    : `Sorry, we had to cancel order ${number}.`;

/** The reason line; `{phone}` marks where the store's number goes (a tel: link). */
export function cancellationReason(
  line: CustomerCancelLine | null,
  dishes: readonly string[],
): string {
  switch (line) {
    case 'ranOut':
      return `The kitchen ran out of ${joinDishes(dishes)}, so we couldn't make your order.`;
    case 'tooBusy':
      return 'Our kitchen is too busy to make your order in good time.';
    case 'closedEarly':
      return 'The kitchen had to close early.';
    case 'atYourRequest':
      return 'Cancelled at your request.';
    case 'cantDeliver':
      return "We couldn't deliver to your address.";
    case 'couldNotAccept':
      return "We couldn't accept this order. Call us on {phone} if you think this is a mistake.";
    case 'other':
    default:
      return 'We had to cancel your order. Call us on {phone} if you have questions.';
  }
}

export function cancellationMoney(notice: CancellationNotice, timeZone: string): string {
  const amount = notice.amountCents !== null ? formatPrice(notice.amountCents) : null;
  const card = notice.cardLabel ?? 'your card';
  switch (notice.moneyLine) {
    case 'refunding':
      return `We're refunding ${amount ?? 'your payment'} to ${card}${notice.tipIncluded ? ', tip included' : ''}. It can take 5 to 10 business days to appear.`;
    case 'refunded':
      return `Refunded ${amount ?? 'your payment'} to ${card}${notice.refundedAt ? ` on ${longDate(notice.refundedAt, timeZone)}` : ''}. It can take 5 to 10 business days to appear.`;
    case 'sample':
      return "This sample order had no real card payment, so there's nothing to refund.";
    case 'nothing':
    default:
      return 'Nothing was charged.';
  }
}

export const codeReleasedText = (code: string) => `Your code ${code} is free to use again.`;
export const REFUND_SLOW_TEXT =
  "This is taking longer than usual. If it hasn't reached your card in 10 business days, call us on {phone}.";

/** The one assertive message on the customer side (S5.8). */
export function cancellationAnnouncement(number: string, notice: CancellationNotice): string {
  const reason = cancellationReason(notice.reasonLine, notice.dishes).replace(
    'Call us on {phone}',
    'Call us',
  );
  let money = '';
  if (notice.moneyLine === 'refunding' && notice.amountCents !== null) {
    const card = notice.cardLabel?.replace('•••• ', 'ending ') ?? 'your card';
    money = ` We're refunding ${formatPrice(notice.amountCents)} to ${card}.`;
  } else if (notice.moneyLine === 'nothing') money = ' Nothing was charged.';
  else if (notice.moneyLine === 'sample') {
    money = " This sample order had no real card payment, so there's nothing to refund.";
  }
  return `Order ${number} was cancelled. ${reason}${money}`;
}

// ------------------------------------------------------------------ the timeline (design 6.9)

/** A timeline label for the F5 kinds; F4's kinds keep F4's words. */
export function progressTimelineLabel(entry: CustomerTimelineEntry): string | null {
  switch (entry.kind) {
    case 'accepted':
      return 'Accepted by the kitchen';
    case 'preparing':
      return 'Cooking started';
    case 'ready':
      return 'Ready, waiting for the courier';
    case 'pickedUp':
      return entry.collected ? 'Collected' : 'On its way';
    case 'delivered':
      return entry.amountCents !== null
        ? `Delivered · paid ${formatPrice(entry.amountCents)} in cash`
        : 'Delivered';
    case 'cancelled': {
      const cancellation = entry.cancellation;
      if (!cancellation || cancellation.by !== 'store') return null;
      if (cancellation.reasonLine === 'atYourRequest') return 'Cancelled at your request';
      return `Cancelled · ${cancellationReason(cancellation.reasonLine, cancellation.dishes).replace(' Call us on {phone} if you think this is a mistake.', '').replace(' Call us on {phone} if you have questions.', '')}`;
    }
    default:
      return null;
  }
}

export const timelineTime = (at: string, now: Date, timeZone: string) =>
  orderDateText(at, now, timeZone).replace(/^Today, /, '');

// ------------------------------------------------------------------ order again (design 8)

/** One sentence per item left out (design 8 step 3). */
export function leftOutSentence(item: ReorderLeftOut): string {
  switch (item.kind) {
    case 'extraDropped':
      return `${item.extra ?? 'An extra'} is no longer offered on ${item.dish}, so we left it off.`;
    case 'kitchenRanOut':
      return `The kitchen ran out of ${item.dish} today, so we left it out.`;
    case 'offMenu':
      return `${item.dish} is no longer on our menu, so we left it out.`;
    case 'soldOut':
    default:
      return `${item.dish} is sold out, so we left it out.`;
  }
}

export const addedText = (quantity: number) =>
  `Added ${quantity} ${quantity === 1 ? 'dish' : 'dishes'} to your cart`;
