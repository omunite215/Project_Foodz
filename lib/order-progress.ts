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
      return "It's packed and waiting for the courier.";
    case 'pickedUp':
      return collected ? 'Your order has been handed over.' : 'Your order has left the kitchen.';
    case 'delivered':
    default:
      return view.progress.deliveredAt
        ? `Delivered at ${clockAt(view.progress.deliveredAt, tz)}. Enjoy your meal.`
        : 'Enjoy your meal.';
  }
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

function range(from: string, to: string, timeZone: string) {
  const start = clockAt(from, timeZone);
  const end = clockAt(to, timeZone);
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
): ArrivalText | null {
  if (deliveredAt) {
    const text = `Delivered at ${clockAt(deliveredAt, timeZone)}`;
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
