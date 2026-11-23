import type { OrderStatus, PaymentStatus } from '@/server/db/enums';
import type {
  BoardCard,
  BoardCardLine,
  BoardColumn,
  BoardGone,
  CancelPreview,
  ForwardMove,
  MoneyFlag,
  OrderChangedDetails,
  StaffTimelineEntry,
  TimelineActor,
} from '@/server/modules/board/schema';
import {
  CANCEL_REASON_LABELS,
  HANDOVER_REASON_LABELS,
  MOVE_BACK_REASON_LABELS,
  MOVE_BUTTONS,
  ROLE_LABELS,
  STAFF_STATUS_WORDS,
} from '@/server/modules/board/text';
import type { CardTiming, Tone } from '@/server/modules/board/timing';
import { clockAt } from '@/server/modules/orders/text';
import { formatPrice, plural } from '@/lib/format';

/*
 * Wording for the order board, its dialogs and the staff order detail (F5 design 2 to 5, Copy).
 * Pure functions: the server's HTML, the browser and the unit tests agree. Staff words are not
 * the customer's ("Preparing", not "Cooking").
 */

// ------------------------------------------------------------------ helpers

/** "Pad Thai", "Gimbap and Pad Thai", "Gimbap, Bulgogi and Pad Thai". */
export function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

const minutes = (value: number) => `${value} min`;

/** "7:31:08 pm": the timeline's "Show seconds" (design 5.3, D12). */
export function clockWithSeconds(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h12',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${get('hour')}:${get('minute')}:${get('second')} ${get('dayPeriod').toLowerCase()}`;
}

/** "7:29 pm", always with its minutes (the board's times read alike: "7:00 pm", not "7 pm"). */
export function boardClock(iso: string, timeZone: string): string {
  const clock = clockAt(iso, timeZone);
  return /:\d\d/.test(clock) ? clock : clock.replace(/ (am|pm)$/, ':00 $1');
}

// ------------------------------------------------------------------ columns (design 2.3)

export const COLUMN_WORDS: Record<BoardColumn, string> = {
  new: 'New',
  accepted: 'Accepted',
  preparing: 'Preparing',
  ready: 'Ready',
  outForDelivery: 'Out for delivery',
};

/** The phone tabs keep "Out for delivery" short (design 2.3). */
export const TAB_WORDS: Record<BoardColumn, string> = { ...COLUMN_WORDS, outForDelivery: 'Out' };

/** The address hash of each phone tab, so Back returns to it ("#ready"). */
export const COLUMN_HASHES: Record<BoardColumn, string> = {
  new: 'new',
  accepted: 'accepted',
  preparing: 'preparing',
  ready: 'ready',
  outForDelivery: 'out',
};

export interface ColumnCount {
  /** Cards shown (after filters). */
  shown: number;
  /** Cards in the column. */
  total: number;
  /** Late cards shown. */
  late: number;
  filtered: boolean;
}

/** "2", or "2 of 5" with filters on. */
export const countChipText = (count: ColumnCount) =>
  count.filtered ? `${count.shown} of ${count.total}` : String(count.total);

const ordersPhrase = (count: ColumnCount) =>
  count.filtered
    ? `${count.shown} of ${plural(count.total, 'order')} shown`
    : plural(count.total, 'order');

const latePhrase = (count: ColumnCount) => (count.late > 0 ? `, ${count.late} late` : '');

/** "New, 2 orders, 1 late" (the column's name for screen readers). */
export const columnSpoken = (column: BoardColumn, count: ColumnCount) =>
  `${COLUMN_WORDS[column]}, ${ordersPhrase(count)}${latePhrase(count)}`;

/** "New 2", "Preparing 2 · 1 late", "Out 0". */
export function tabText(column: BoardColumn, count: ColumnCount): string {
  const late = count.late > 0 ? ` · ${count.late} late` : '';
  return `${TAB_WORDS[column]} ${countChipText(count)}${late}`;
}

export const collapseLabel = (column: BoardColumn) => `Collapse ${COLUMN_WORDS[column]} column`;
/** " column, 2 orders, 1 late": what follows the column's name on its collapsed strip. */
export const collapsedSuffix = (count: ColumnCount) =>
  ` column, ${ordersPhrase(count)}${latePhrase(count)}`;

/** "Expand New column, 2 orders, 1 late". */
export const expandLabel = (column: BoardColumn, count: ColumnCount) =>
  `Expand ${COLUMN_WORDS[column]}${collapsedSuffix(count)}`;

export const newBelowText = (count: number) =>
  `${count} new ${count === 1 ? 'order' : 'orders'} below`;

// ------------------------------------------------------------------ the time block (design 2.5)

export interface TimeBlockText {
  tone: Tone;
  /** Words before the big minutes ("Late", "Due in", "Waiting"). */
  before: string | null;
  /** The 20 px figure ("10 min"); null when the words say it ("Just in"). */
  figure: string | null;
  /** Words after it ("left", "for pickup"). */
  after: string | null;
  /** The second line ("Ready by 7:53 pm", "Placed 7:29 pm"). */
  line: string | null;
  /** Both read together: "Ready by 7:53 pm, 23 min left". */
  spoken: string;
}

const join = (...parts: (string | null)[]) => parts.filter(Boolean).join(' ');

export function timeBlockText(
  timing: CardTiming,
  card: Pick<BoardCard, 'placedAt' | 'pickedUpAt'>,
  timeZone: string,
): TimeBlockText {
  let before: string | null = null;
  let figure: string | null = null;
  let after: string | null = null;
  let line: string | null = null;

  switch (timing.kind) {
    case 'waiting': {
      line = `Placed ${boardClock(card.placedAt, timeZone)}`;
      if (timing.minutes < 1) before = 'Just in';
      else {
        before = timing.tone === 'late' ? 'Late · waiting' : 'Waiting';
        figure = minutes(timing.minutes);
      }
      break;
    }
    case 'readyBy': {
      if (!timing.readyBy) {
        before = 'No ready-by time';
        line = `Placed ${boardClock(card.placedAt, timeZone)}`;
        break;
      }
      line = `Ready by ${boardClock(timing.readyBy, timeZone)}`;
      if (timing.lateMinutes !== null) {
        before = 'Late';
        figure = minutes(timing.lateMinutes);
      } else if (timing.tone === 'soon') {
        if ((timing.minutesLeft ?? 0) < 1) before = 'Due now';
        else {
          before = 'Due in';
          figure = minutes(timing.minutesLeft ?? 0);
        }
      } else {
        figure = minutes(timing.minutesLeft ?? 0);
        after = 'left';
      }
      break;
    }
    case 'ready': {
      if (timing.minutes < 1) before = 'Ready just now';
      else if (timing.tone === 'late') {
        before = 'Waiting';
        figure = minutes(timing.minutes);
        after = 'for pickup';
      } else {
        before = 'Ready';
        figure = minutes(timing.minutes);
      }
      break;
    }
    case 'out':
    default: {
      if (card.pickedUpAt) line = `Picked up ${boardClock(card.pickedUpAt, timeZone)}`;
      if (timing.minutes < 1) before = 'Out just now';
      else {
        before = 'Out';
        figure = minutes(timing.minutes);
      }
    }
  }

  const block = join(before?.replace(' · ', ', ') ?? null, figure, after);
  const spokenBlock = line ? block.charAt(0).toLowerCase() + block.slice(1) : block;
  const spoken = line ? `${line}, ${spokenBlock}` : block;
  return { tone: timing.tone, before, figure, after, line, spoken };
}

// ------------------------------------------------------------------ cards (design 2.4 to 2.7)

export const MONEY_FLAG_LABELS: Record<MoneyFlag, string> = {
  refunded: 'Refunded',
  partlyRefunded: 'Partly refunded',
  disputed: 'Disputed',
  paidLate: 'Paid late',
};

/** "Cash", "Card · paid"; for support and admin "Cash · $53.97 to collect", "Card · $53.97 paid". */
export function paymentChipText(payment: BoardCard['payment']): string {
  if ('paid' in payment) {
    if (payment.method === 'cash') return 'Cash';
    return payment.paid ? 'Card · paid' : 'Card';
  }
  const total = formatPrice(payment.totalCents);
  if (payment.method === 'cash') {
    return payment.status === 'UNPAID' ? `Cash · ${total} to collect` : `Cash · ${total} paid`;
  }
  return payment.status === 'UNPAID' ? `Card · ${total}` : `Card · ${total} paid`;
}

export type PrimaryAction = ForwardMove | 'pickUp' | 'deliver';

export const PRIMARY_WORDS: Record<PrimaryAction, string> = {
  ...MOVE_BUTTONS,
  pickUp: 'Mark picked up',
  deliver: 'Mark delivered',
};

export const MENU_WORDS = {
  details: 'Details',
  moveBack: 'Move back',
  pickUp: 'Mark picked up',
  deliver: 'Mark delivered',
  refuse: "Can't make it",
  cancel: 'Cancel order',
} as const;

export const READ_ONLY_CAPTION = 'Read-only in the demo';
export const OFFLINE_CAPTION = "You're offline.";
export const HIDDEN_FOR_DEMO = 'Hidden for demo staff';
export const WAITING_FOR_PICKUP = 'Waiting for pickup';

// ------------------------------------------------------------------ announcements and notices

/** "New order 1043, 3 items" / "3 new orders" (A3.1). */
export function newOrdersAnnouncement(cards: readonly Pick<BoardCard, 'number' | 'itemCount'>[]) {
  if (cards.length === 1) {
    const [card] = cards;
    return `New order ${card?.number}, ${plural(card?.itemCount ?? 0, 'item')}`;
  }
  return `${cards.length} new orders`;
}

const STATUS_FOR_MOVES: Partial<Record<OrderStatus, string>> = {
  PLACED: 'New',
  ACCEPTED: 'Accepted',
  PREPARING: 'Preparing',
  READY: 'Ready',
  PICKED_UP: 'Out for delivery',
};

export const movedAnnouncement = (number: string, status: OrderStatus) =>
  `Order ${number} moved to ${STATUS_FOR_MOVES[status] ?? STAFF_STATUS_WORDS[status]}`;

/** The rest of the Undo button's name: "Undo, move order S1103 back to Accepted". */
export const undoSpoken = (number: string, status: OrderStatus) =>
  `move order ${number} back to ${STATUS_FOR_MOVES[status] ?? STAFF_STATUS_WORDS[status]}`;

export const movedBackAnnouncement = (number: string, status: OrderStatus) =>
  `Order ${number} moved back to ${STATUS_FOR_MOVES[status] ?? STAFF_STATUS_WORDS[status]}`;

/** "Alex Kim", "Morgan Diaz (Support)" with the role; "the customer", "Stripe", "Foodz (automatic)". */
export function actorText(actor: TimelineActor, withRole = true): string {
  switch (actor.kind) {
    case 'staff': {
      const name = actor.name ?? 'A staff member';
      return withRole ? `${name} (${ROLE_LABELS[actor.role]})` : name;
    }
    case 'customer':
      return 'the customer';
    case 'stripe':
      return 'Stripe';
    case 'system':
    default:
      return 'Foodz (automatic)';
  }
}

/** Why a card left the board, for the notice (A3.7); null when it needs no notice. */
export function goneNotice(gone: BoardGone): string | null {
  if (gone.left !== 'cancelled') return null;
  if (!gone.by || gone.by.kind === 'system' || gone.by.kind === 'stripe') {
    return `Order ${gone.number} was cancelled.`;
  }
  return `Order ${gone.number} was cancelled by ${actorText(gone.by)}.`;
}

/** Announced when someone else's hand-over takes a card off this board. */
export function goneAnnouncement(gone: BoardGone): string {
  if (gone.left === 'pickedUp') return `Order ${gone.number} marked picked up`;
  if (gone.left === 'delivered') return `Order ${gone.number} marked delivered`;
  return goneNotice(gone) ?? `Order ${gone.number} left the board`;
}

const ALREADY: Partial<Record<OrderStatus, string>> = {
  ACCEPTED: 'Already accepted',
  PREPARING: 'Already cooking',
  READY: 'Already ready',
};

/** "(moved back by Foodz Admin)" in a conflict sentence. */
function howPhrase(details: OrderChangedDetails): string {
  const change = details.lastChange;
  if (!change) return '';
  const by = actorText(change.by, false);
  switch (change.how) {
    case 'moved':
      return ` (moved by ${by})`;
    case 'moved-back':
      return ` (moved back by ${by})`;
    case 'undone':
      return ` (undone by ${by})`;
    default:
      return '';
  }
}

/**
 * The calm reason on a card after ORDER_CHANGED (A5.1, A5.2, A5.4, design 2.8): "Already
 * cooking · moved by Alex Kim at 7:41 pm", "Order 1044 was cancelled by the customer at 7:31
 * pm.", or "Order 1042 changed a moment ago. It's now Accepted (moved back by Foodz Admin).
 * Check it and try again."
 */
export function conflictText(
  details: OrderChangedDetails,
  attempted: OrderStatus | null,
  timeZone: string,
): string {
  const change = details.lastChange;
  const at = change ? boardClock(change.at, timeZone) : null;
  const already = ALREADY[details.current.status];
  if (change && change.how === 'moved' && attempted === details.current.status && already) {
    return `${already} · moved by ${actorText(change.by, false)} at ${at}`;
  }
  if (change && (change.how === 'cancelled-by-customer' || change.how === 'cancelled-by-staff')) {
    return `Order ${details.number} was cancelled by ${actorText(change.by)} at ${at}.`;
  }
  if (change && change.how === 'refused') {
    return `Order ${details.number} was refused by ${actorText(change.by)} at ${at}.`;
  }
  return `Order ${details.number} changed a moment ago. It's now ${STAFF_STATUS_WORDS[details.current.status]}${howPhrase(details)}. Check it and try again.`;
}

/** The order moved on while a dialog was open (design 3.4): still possible. */
export function changedWhileDecidingText(
  number: string,
  status: OrderStatus,
  by: TimelineActor | null,
  at: string | null,
  timeZone: string,
  question: string,
): string {
  const who = by ? actorText(by, false) : null;
  const when = at ? boardClock(at, timeZone) : null;
  const aside = [who, when].filter(Boolean).join(', ');
  return `Order ${number} changed while you were deciding. It's now ${STAFF_STATUS_WORDS[status]}${aside ? ` (${aside})` : ''}. ${question}`;
}

export const unreachableText = (number: string) =>
  `We couldn't reach the server, so order ${number} wasn't moved. Try again.`;

// ------------------------------------------------------------------ banners (design 1.5)

export const DEMO_BANNER =
  "Demo admin: you can look around, but changes are switched off. Real customers' details are masked.";

export const sessionEndingText = (expiresAt: string, timeZone: string) =>
  `Your session ends at ${boardClock(expiresAt, timeZone)}. Sign in again now to keep the board live.`;

export const pausedText = (lastUpdate: string | null, timeZone: string) =>
  lastUpdate
    ? `Live updates paused. Last update ${boardClock(lastUpdate, timeZone)}. Reconnecting…`
    : 'Live updates paused. Reconnecting…';

export const OUT_OF_DATE_TEXT =
  'The board may be out of date. Check an order before you act on it.';
export const NO_REALTIME_TEXT =
  "Live updates aren't available. The board refreshes every 10 seconds.";
export const OFFLINE_TEXT = "You're offline. The board will catch up when you're back online.";

export function backOnlineText(changed: number): string {
  if (changed === 0) return 'Back online. Nothing changed while you were away.';
  return `Back online. ${changed} ${changed === 1 ? 'order' : 'orders'} changed while you were away.`;
}

/** A3.6: "Order 1042 has waited 6 minutes. …" / "2 orders have waited over 5 minutes." */
export function waitingBannerText(
  waiting: readonly { number: string; minutes: number }[],
  overMinutes: number,
): { text: string; action: string } | null {
  if (waiting.length === 0) return null;
  const [oldest] = waiting;
  if (waiting.length === 1 && oldest) {
    return {
      text: `Order ${oldest.number} has waited ${plural(oldest.minutes, 'minute')}. Accept it, or tell the customer we can't make it.`,
      action: `Show order ${oldest.number}`,
    };
  }
  return {
    text: `${waiting.length} orders have waited over ${plural(overMinutes, 'minute')}.`,
    action: 'Show the oldest',
  };
}

export const hiddenByFiltersText = (count: number) =>
  `${count} new ${count === 1 ? 'order' : 'orders'} hidden by filters`;

// ------------------------------------------------------------------ "86 it" (design 4)

/** "Sold out: Pad Thai, Naengmyeon" / "…, Bulgogi and 2 more" from four dishes. */
export function soldOutStripText(titles: readonly string[]): string {
  if (titles.length <= 3) return `Sold out: ${titles.join(', ')}`;
  return `Sold out: ${titles.slice(0, 3).join(', ')} and ${titles.length - 3} more`;
}

export const soldOutButtonLabel = (count: number) =>
  count > 0 ? `Sold out dishes, ${count}` : 'Sold out dishes';

export const soldOutSinceText = (since: string | null, by: string | null, timeZone: string) => {
  const parts = [since ? `Sold out since ${boardClock(since, timeZone)}` : 'Sold out', by];
  return parts.filter(Boolean).join(' · ');
};

// ------------------------------------------------------------------ dialogs (design 3)

export const refuseTitle = (number: string) => `Can't make order ${number}?`;
export const cancelTitle = (number: string) => `Cancel order ${number}?`;
export const moveBackTitle = (number: string, to: OrderStatus) =>
  `Move order ${number} back to ${STATUS_FOR_MOVES[to] ?? STAFF_STATUS_WORDS[to]}?`;
export const pickUpTitle = (number: string) => `Mark order ${number} picked up?`;
export const deliverTitle = (number: string) => `Mark order ${number} delivered?`;
export const keepInColumnText = (status: OrderStatus) =>
  `Keep it in ${STATUS_FOR_MOVES[status] ?? STAFF_STATUS_WORDS[status]}`;

/**
 * "Which dishes?" labels: a dish on two lines is told apart by its extras ("Gimbap
 * (Gochujang)", "Gimbap"); anything still alike gets a number.
 */
export function dishChoiceLabels(lines: readonly BoardCardLine[]): Map<string, string> {
  const byTitle = new Map<string, number>();
  for (const line of lines) byTitle.set(line.title, (byTitle.get(line.title) ?? 0) + 1);
  const labels = new Map<string, string>();
  const used = new Map<string, number>();
  for (const line of lines) {
    let label =
      (byTitle.get(line.title) ?? 0) > 1 && line.flavors.length > 0
        ? `${line.title} (${line.flavors.join(', ')})`
        : line.title;
    const seen = used.get(label) ?? 0;
    used.set(label, seen + 1);
    if (seen > 0) label = `${label} (${seen + 1})`;
    labels.set(line.id, label);
  }
  return labels;
}

/** "Also mark Pad Thai sold out on the menu"; null when every ticked dish already is. */
export function alsoSoldOutText(
  lines: readonly BoardCardLine[],
  tickedLineIds: readonly string[],
): string | null {
  const titles = [
    ...new Set(
      lines
        .filter((line) => tickedLineIds.includes(line.id) && !line.soldOut)
        .map((line) => line.title),
    ),
  ];
  return titles.length ? `Also mark ${joinWords(titles)} sold out on the menu` : null;
}

/** What will happen, for the "Can't make it" dialog (design 3.2): no amounts for the kitchen. */
export function refuseOutcomeText(preview: CancelPreview): string {
  const card =
    preview.view === 'kitchen' ? preview.refund === 'card' : preview.refund.kind === 'card';
  return card
    ? 'The customer gets a full refund to their card and a message saying why.'
    : 'Nothing was charged. The customer gets a message saying why.';
}

/** What will happen, for staff "Cancel order" (design 3.3), one line each. */
export function cancelOutcomeLines(preview: CancelPreview): string[] {
  const lines: string[] = [];
  if (preview.view === 'kitchen') {
    lines.push(refuseOutcomeText(preview));
  } else if (preview.refund.kind === 'card') {
    const card = preview.refund.cardLabel ?? 'the card';
    const amount = formatPrice(preview.refund.amountCents);
    lines.push(
      preview.refund.tipIncluded
        ? `We'll refund ${amount} to ${card} in full, tip included. Partial refunds come later, in Refunds.`
        : `We'll refund ${amount} to ${card} in full. Partial refunds come later, in Refunds.`,
    );
  } else if (preview.refund.kind === 'sample') {
    lines.push("Sample order: there's no card payment to refund.");
  } else {
    lines.push("Nothing was charged, so there's nothing to refund.");
  }
  if (preview.view === 'full' && preview.codeToRelease) {
    lines.push(`${preview.codeToRelease} will be released so it can be used again.`);
  }
  if (preview.kitchenStarted) lines.push('The kitchen has already started on this order.');
  return lines;
}

export const refusedAnnouncement = (number: string) =>
  `Order ${number} refused. The customer has been told.`;
export const cancelledAnnouncement = (number: string) =>
  `Order ${number} cancelled. The customer has been told.`;
export const pickedUpAnnouncement = (number: string) => `Order ${number} marked picked up`;
export const deliveredAnnouncement = (number: string) => `Order ${number} marked delivered`;
export const cashCollectedLabel = (cents: number) => `Collected ${formatPrice(cents)} in cash`;
export const stepUpLockedText = (retryAt: string, timeZone: string) =>
  `Too many wrong codes. Try again at ${boardClock(retryAt, timeZone)}.`;

// ------------------------------------------------------------------ the detail (design 5)

export const PAYMENT_STATUS_WORDS: Record<PaymentStatus, string> = {
  UNPAID: 'Not paid',
  PAID: 'Paid',
  PARTIALLY_REFUNDED: 'Partly refunded',
  REFUNDED: 'Refunded',
};

/** "Placed 7:29 pm · 18 min ago". */
export function placedLine(placedAt: string, now: Date, timeZone: string): string {
  const ago = Math.max(0, Math.floor((now.getTime() - Date.parse(placedAt)) / 60_000));
  return `Placed ${boardClock(placedAt, timeZone)} · ${ago < 1 ? 'just now' : `${minutes(ago)} ago`}`;
}

/** "Promised for 8:09–8:19 pm" (both ends keep am/pm only when they differ). */
export function promisedLine(from: string, to: string, timeZone: string): string {
  const start = boardClock(from, timeZone);
  const end = boardClock(to, timeZone);
  const sameHalf = start.slice(-2) === end.slice(-2);
  return `Promised for ${sameHalf ? start.slice(0, -3) : start}–${end}`;
}

/** "Accepted after 1 min · cooked in 19 min · ready 3 min late"; null with nothing to say. */
export function howItWentLine(how: {
  acceptedAfterMinutes: number | null;
  cookedInMinutes: number | null;
  readyLateMinutes: number | null;
}): string | null {
  const parts: string[] = [];
  if (how.acceptedAfterMinutes !== null)
    parts.push(`accepted after ${minutes(how.acceptedAfterMinutes)}`);
  if (how.cookedInMinutes !== null) parts.push(`cooked in ${minutes(how.cookedInMinutes)}`);
  if (how.readyLateMinutes !== null) {
    if (how.readyLateMinutes > 0) parts.push(`ready ${minutes(how.readyLateMinutes)} late`);
    else if (how.readyLateMinutes < 0) parts.push(`ready ${minutes(-how.readyLateMinutes)} early`);
    else parts.push('ready on time');
  }
  if (parts.length === 0) return null;
  const text = parts.join(' · ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Card · Visa •••• 4242 · Paid", "Cash · $53.97 to collect", "Cash · paid $53.97". */
export function methodLine(money: {
  method: 'cash' | 'card';
  cardLabel: string | null;
  paymentStatus: PaymentStatus;
  totalCents: number;
}): string {
  if (money.method === 'cash') {
    return money.paymentStatus === 'UNPAID'
      ? `Cash · ${formatPrice(money.totalCents)} to collect`
      : `Cash · paid ${formatPrice(money.totalCents)}`;
  }
  return ['Card', money.cardLabel, PAYMENT_STATUS_WORDS[money.paymentStatus]]
    .filter(Boolean)
    .join(' · ');
}

/** "Card declined: insufficient funds". */
export function declineText(decline: { code: string | null; declineCode: string | null }): string {
  const reason = decline.declineCode ?? decline.code;
  return reason ? `Card declined: ${reason.replaceAll('_', ' ')}` : 'Card declined';
}

export interface TimelineText {
  sentence: string;
  /** Under the sentence: dishes, a reason, a refund amount. */
  details: string | null;
  /** "Staff note: …". */
  note: string | null;
}

const statusWord = (status: OrderStatus | null) =>
  status ? (STATUS_FOR_MOVES[status] ?? STAFF_STATUS_WORDS[status]) : 'the step before';

const plain = (
  sentence: string,
  details: string | null = null,
  note: string | null = null,
): TimelineText => ({ sentence, details, note });

/** One entry of the staff timeline (design 5.3, story B17). */
export function timelineText(entry: StaffTimelineEntry): TimelineText {
  const by = actorText(entry.by);
  switch (entry.type) {
    case 'created':
      return plain('Created, waiting for card payment');
    case 'placed':
      return plain(
        entry.method === 'cash'
          ? 'Placed · cash'
          : `Placed · paid with ${entry.cardLabel ?? 'a card'}`,
      );
    case 'paid':
      return plain('Payment confirmed');
    case 'payment-failed':
      return plain(declineText(entry.decline));
    case 'accepted':
      return plain(`Accepted by ${by}`);
    case 'preparing':
      return plain(`Cooking started by ${by}`);
    case 'ready': {
      const late =
        entry.lateMinutes === null
          ? ''
          : entry.lateMinutes > 0
            ? ` · ${minutes(entry.lateMinutes)} late`
            : ' · on time';
      return plain(`Ready · marked by ${by}${late}`);
    }
    case 'undone':
      return plain(`${actorText(entry.by, false)} undid ${MOVE_BUTTONS[entry.undid]}`);
    case 'moved-back':
      return plain(
        `Moved back to ${statusWord(entry.toStatus)} by ${by}: ${MOVE_BACK_REASON_LABELS[entry.reason]}`,
        null,
        entry.note,
      );
    case 'refused': {
      const dishes = entry.dishes.length ? ` (${joinWords(entry.dishes)})` : '';
      return plain(
        `Refused by ${by}: ${CANCEL_REASON_LABELS[entry.reason]}${dishes}`,
        null,
        entry.note,
      );
    }
    case 'cancelled': {
      if (entry.reason === 'customer') return plain('Cancelled by the customer');
      if (entry.reason === 'payment-expired') return plain('Expired: not paid within 15 minutes');
      if (entry.reason === 'account-deleted')
        return plain('Cancelled: the customer deleted their account');
      const reason = entry.code ? `: ${CANCEL_REASON_LABELS[entry.code]}` : '';
      const dishes = entry.dishes.length ? ` (${joinWords(entry.dishes)})` : '';
      return plain(`Cancelled by ${by}${reason}${dishes}`, null, entry.note);
    }
    case 'expired':
      return plain('Expired: not paid within 15 minutes');
    case 'refunded':
      return plain(
        entry.amountCents === null
          ? 'Refunded to the customer'
          : `Refunded ${formatPrice(entry.amountCents)} to ${entry.cardLabel ?? 'the card'}`,
      );
    case 'picked-up':
      return plain(
        entry.reason
          ? `Picked up · marked by ${by}: ${HANDOVER_REASON_LABELS[entry.reason]}`
          : `Picked up · marked by ${by}`,
        null,
        entry.note,
      );
    case 'delivered': {
      const cash =
        entry.cashCollectedCents !== null
          ? ` · cash ${formatPrice(entry.cashCollectedCents)} collected`
          : '';
      return plain(
        `Delivered · marked by ${by}${cash}`,
        entry.reason ? HANDOVER_REASON_LABELS[entry.reason] : null,
        entry.note,
      );
    }
    case 'revived':
      return plain('Order revived after a late payment');
    case 'late-payment':
      return plain('Payment arrived after the order expired');
    case 'mismatch':
      return plain("The payment didn't match the order total");
    case 'dispute-opened':
      return plain('The customer opened a dispute with their bank');
    case 'dispute-closed':
      return plain(entry.outcome ? `Dispute closed: ${entry.outcome}` : 'Dispute closed');
    case 'sold-out':
    default:
      return plain(
        `${joinWords(entry.type === 'sold-out' ? entry.dishes : [])} marked sold out by ${by}`,
      );
  }
}
