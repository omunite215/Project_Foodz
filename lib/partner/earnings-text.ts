import type {
  CashBreakdown,
  CashCard,
  DeliveryHow,
  EarningsDeliveryDetail,
  EarningsRow,
  EarningsWeekBlock,
  EarningsWeekDay,
  IsoDate,
  TodayLine,
} from '@/server/modules/earnings/schema';
import { PAYOUT_DAY_WORDS } from '@/server/modules/earnings/schema';
import { addDays, goalPercent } from '@/server/modules/earnings/rules';
import { METHOD_WORDS, signedPrice } from '@/server/modules/earnings/text';
import { clockAt } from '@/server/modules/orders/text';
import { TAG_WORDS, isTag } from '@/server/modules/ratings/schema';
import { formatPrice, formatRating, plural } from '@/lib/format';

/*
 * The partner's Earnings and ratings words (F9 design 1): row lines, day headers, durations, the
 * ring's spoken sentence, the cash card, the week, the Home line. Pure functions, so the server
 * render and the phone read the same text. Spoken text is built from parts, never by trimming
 * visible text. Store dates arrive as ISO dates; instants are shown in the store's time zone.
 */

export { signedPrice };

// ------------------------------------------------------------------ money and time

/** "$40" for whole dollars (a goal), otherwise "$40.50". */
export function wholeDollars(cents: number): string {
  if (cents % 100 !== 0) return formatPrice(cents);
  return `$${(cents / 100).toLocaleString('en-US')}`;
}

/** "45 min", "2 h 11 min", "13 h 06 min", "0 min" (B12). */
export function durationWords(seconds: number): string {
  const minutes = Math.max(0, Math.floor(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${String(minutes % 60).padStart(2, '0')} min`;
}

/** "2 hours 11 minutes", "45 minutes", "1 hour". */
export function spokenDuration(seconds: number): string {
  const minutes = Math.max(0, Math.floor(seconds / 60));
  if (minutes < 60) return plural(minutes, 'minute');
  const hours = plural(Math.floor(minutes / 60), 'hour');
  const rest = minutes % 60;
  return rest === 0 ? hours : `${hours} ${plural(rest, 'minute')}`;
}

export const deliveriesWords = (count: number) => plural(count, 'delivery', 'deliveries');

/** "3 deliveries · $8.00 tips · online 2 h 11 min". */
export function figuresLine(figures: {
  deliveries: number;
  tipsCents: number;
  onlineSeconds: number;
}): string {
  return [
    deliveriesWords(figures.deliveries),
    `${formatPrice(figures.tipsCents)} tips`,
    `online ${durationWords(figures.onlineSeconds)}`,
  ].join(' · ');
}

// ------------------------------------------------------------------ dates

const DAY_FORMATS = {
  short: new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }),
  weekday: new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long' }),
  weekdayShort: new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }),
  monthDay: new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }),
  month: new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short' }),
  day: new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', day: 'numeric' }),
};

const noon = (date: IsoDate) => new Date(`${date}T12:00:00Z`);

/** "Fri, Nov 20". */
export const shortDay = (date: IsoDate) => DAY_FORMATS.short.format(noon(date));
/** "Wednesday". */
export const weekdayName = (date: IsoDate) => DAY_FORMATS.weekday.format(noon(date));
/** "Wed". */
export const weekdayShort = (date: IsoDate) => DAY_FORMATS.weekdayShort.format(noon(date));
/** "Nov 18". */
export const monthDay = (date: IsoDate) => DAY_FORMATS.monthDay.format(noon(date));

/** "Fri, Nov 20" for an instant, in the store's zone. */
export function shortDayAt(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(iso));
}

const sameMonth = (a: IsoDate, b: IsoDate) => a.slice(0, 7) === b.slice(0, 7);

/** "Mon, Nov 16 – Sun, Nov 22". */
export const weekRangeWords = (start: IsoDate, end: IsoDate) =>
  `${shortDay(start)} – ${shortDay(end)}`;

/** "Nov 16 – 22", "Nov 30 – Dec 6". */
export function shortRange(start: IsoDate, end: IsoDate): string {
  if (sameMonth(start, end)) return `${monthDay(start)} – ${DAY_FORMATS.day.format(noon(end))}`;
  return `${monthDay(start)} – ${monthDay(end)}`;
}

/** "Nov 9 to 15", "Nov 30 to Dec 6": the spoken form of a short range. */
export function spokenRange(start: IsoDate, end: IsoDate): string {
  if (sameMonth(start, end)) return `${monthDay(start)} to ${DAY_FORMATS.day.format(noon(end))}`;
  return `${monthDay(start)} to ${monthDay(end)}`;
}

// ------------------------------------------------------------------ the week (1.2, 1.6)

export const previousWeekName = (start: IsoDate) =>
  `Previous week, ${spokenRange(addDays(start, -7), addDays(start, -1))}`;
export const nextWeekName = (start: IsoDate) =>
  `Next week, ${spokenRange(addDays(start, 7), addDays(start, 13))}`;
export const FIRST_WEEK_WORDS = 'This is your first week.';
export const CURRENT_WEEK_WORDS = 'This is the current week.';

/** "This week", "Last week", "Week of Nov 2". */
export function weekTitle(start: IsoDate, currentStart: IsoDate): string {
  if (start === currentStart) return 'This week';
  if (start === addDays(currentStart, -7)) return 'Last week';
  return `Week of ${monthDay(start)}`;
}

/** "Last week: $96.40" on the current week, "Week before: $0.00" earlier; none on his first. */
export function compareLine(
  week: Pick<EarningsWeekBlock, 'isCurrent' | 'previousWeekEarnedCents'>,
) {
  if (week.previousWeekEarnedCents === null) return null;
  const amount = formatPrice(week.previousWeekEarnedCents);
  return week.isCurrent ? `Last week: ${amount}` : `Week before: ${amount}`;
}

/** "Days, Mon, Nov 16 to Sun, Nov 22". */
export const daysLabel = (start: IsoDate, end: IsoDate) =>
  `Days, ${shortDay(start)} to ${shortDay(end)}`;

/** "Wednesday, Nov 18: $41.85, 6 deliveries", "Tuesday, Nov 17: no deliveries". */
export function dayButtonName(day: EarningsWeekDay): string {
  const name = `${weekdayName(day.date)}, ${monthDay(day.date)}${day.state === 'today' ? ', today' : ''}`;
  if (day.state === 'future') return `${name}: hasn't happened yet`;
  if (day.earnedCents === 0 && day.deliveries === 0) return `${name}: no deliveries`;
  return `${name}: ${formatPrice(day.earnedCents)}, ${deliveriesWords(day.deliveries)}`;
}

/** "Mon" … "Sun", or "Today". */
export const dayLabel = (day: EarningsWeekDay) =>
  day.state === 'today' ? 'Today' : weekdayShort(day.date);

/** A bar's height as a share of the week's best day (at least a sliver above $0). */
export function barShare(earnedCents: number, highestCents: number): number {
  if (earnedCents <= 0 || highestCents <= 0) return 0;
  return Math.max(0.05, earnedCents / highestCents);
}

/** "Today · $19.57" / "Thursday, Nov 19 · $36.20". */
export function dayHeader(date: IsoDate, today: IsoDate, earnedCents: number): string {
  const name = date === today ? 'Today' : `${weekdayName(date)}, ${monthDay(date)}`;
  return `${name} · ${formatPrice(earnedCents)}`;
}

/** "This week: $126.02": what a segment or week change announces. */
export const periodAnnouncement = (title: string, earnedCents: number) =>
  `${title}: ${formatPrice(earnedCents)}`;

// ------------------------------------------------------------------ today and the goal (1.4, 1.5)

export const goalOfWords = (goalCents: number) => `of ${wholeDollars(goalCents)} goal`;

/** The ring's spoken sentence (P63.3). */
export function ringSentence(earnedCents: number, goalCents: number): string {
  if (earnedCents >= goalCents) {
    return `Today ${formatPrice(earnedCents)}, goal of ${wholeDollars(goalCents)} reached`;
  }
  return `Today ${formatPrice(earnedCents)} of your ${wholeDollars(goalCents)} goal, ${goalPercent(earnedCents, goalCents)} percent`;
}

/** Announced once that day when he crosses his goal with the tab open. */
export const goalReachedAnnouncement = (earnedCents: number) =>
  `Goal reached. ${formatPrice(earnedCents)} today.`;

/** 8 characters or more steps the ring's amount down a size ("$1,000.00"). */
export const longAmount = (cents: number) => formatPrice(cents).length >= 8;

export const GOAL_CHOICES = [5_000, 10_000, 15_000, 20_000] as const;
export type GoalChoice = (typeof GOAL_CHOICES)[number] | 'custom' | 'none';

/** The sheet's starting choice: his goal; nothing checked without one (U7: never a suggestion). */
export function goalChoiceOf(goalCents: number | null): GoalChoice | null {
  if (goalCents === null) return null;
  return GOAL_CHOICES.find((choice) => choice === goalCents) ?? 'custom';
}

/** The goal a choice saves: a preset, the typed dollars, or none. Undefined while invalid. */
export function goalFromChoice(choice: GoalChoice, customText: string): number | null | undefined {
  if (choice === 'none') return null;
  if (choice === 'custom') return parseGoalDollars(customText) ?? undefined;
  return choice;
}

export const GOAL_ERROR = 'Enter whole dollars from $10 to $1,000.';

/** "40" gives 4000 cents; anything but whole dollars from 10 to 1,000 gives null. */
export function parseGoalDollars(text: string): number | null {
  const trimmed = text.trim().replace(/^\$/, '').replaceAll(',', '');
  if (!/^\d{1,4}$/.test(trimmed)) return null;
  const dollars = Number(trimmed);
  return dollars >= 10 && dollars <= 1_000 ? dollars * 100 : null;
}

// ------------------------------------------------------------------ the list (1.7)

/** The row's first line: "7:46 pm · Order 1042 · Boston 02109". */
export function rowFirstLine(row: EarningsRow, timeZone: string): string {
  const time = clockAt(row.at, timeZone);
  switch (row.kind) {
    case 'delivery':
      return [time, `Order ${row.orderNumber ?? ''}`.trim(), row.areaWords]
        .filter(Boolean)
        .join(' · ');
    case 'cancelledAfterPickup':
      return `${time} · Order ${row.orderNumber ?? ''} · cancelled after pickup`;
    case 'cashHandedIn':
      return 'Cash handed in';
    case 'added':
      return 'Added by Foodz';
    case 'takenOff':
      return 'Taken off by Foodz';
    case 'payout':
    default:
      return `Paid to you · ${row.method ? METHOD_WORDS[row.method] : 'Other'}`;
  }
}

function deliveryExtras(row: EarningsRow): string[] {
  const parts: string[] = [];
  if (row.tipCents && row.tipCents > 0) parts.push(`includes ${formatPrice(row.tipCents)} tip`);
  if (row.cashCents && row.cashCents > 0)
    parts.push(`cash collected ${formatPrice(row.cashCents)}`);
  return parts;
}

/** The row's second line, or null: "includes $5.00 tip · cash collected $58.97". */
export function rowSecondLine(row: EarningsRow, timeZone: string): string | null {
  const time = clockAt(row.at, timeZone);
  switch (row.kind) {
    case 'delivery': {
      const parts = deliveryExtras(row);
      return parts.length ? parts.join(' · ') : null;
    }
    case 'cancelledAfterPickup':
      return 'delivery fee';
    case 'cashHandedIn':
      return `${time} · Recorded by Foodz support`;
    case 'added':
    case 'takenOff':
      return row.message ? `${time} · ${row.message}` : time;
    case 'payout':
    default:
      return row.reference ? `${time} · ${row.reference}` : time;
  }
}

/** Signs only on additions and take-offs (P55.1). */
export function rowAmount(row: EarningsRow): string {
  if (row.kind === 'added' || row.kind === 'takenOff') return signedPrice(row.amountCents);
  return formatPrice(Math.abs(row.amountCents));
}

/** A delivery row's name: "Order 1042, 7:46 pm, $7.64, includes $5.00 tip, cash collected $58.97". */
export function deliveryRowName(row: EarningsRow, timeZone: string): string {
  const parts = [
    `Order ${row.orderNumber ?? ''}`.trim(),
    clockAt(row.at, timeZone),
    formatPrice(row.amountCents),
  ];
  if (row.kind === 'cancelledAfterPickup') parts.push('cancelled after pickup, delivery fee');
  else parts.push(...deliveryExtras(row));
  return parts.join(', ');
}

/** True for the rows that open the delivery sheet. */
export const opensSheet = (row: EarningsRow) =>
  row.kind === 'delivery' || row.kind === 'cancelledAfterPickup';

// ------------------------------------------------------------------ the delivery sheet (1.8)

/** "Fri, Nov 20 · Boston 02109 · 1.3 km from the kitchen". */
export function deliverySubtitle(
  detail: Pick<EarningsDeliveryDetail, 'date' | 'areaWords' | 'distanceKm'>,
): string {
  return [
    shortDay(detail.date),
    detail.areaWords,
    detail.distanceKm === null ? null : `${detail.distanceKm.toFixed(1)} km from the kitchen`,
  ]
    .filter(Boolean)
    .join(' · ');
}

const STEP_WORDS: Record<EarningsDeliveryDetail['steps'][number]['kind'], string> = {
  accepted: 'Accepted',
  pickedUp: 'Picked up',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

/** "Accepted 7:40 pm". */
export const stepWords = (step: EarningsDeliveryDetail['steps'][number], timeZone: string) =>
  `${STEP_WORDS[step.kind]} ${clockAt(step.at, timeZone)}`;

/** How it ended (design 1.8's table); the tip sentence only when the order had one (P12). */
export function endedWords(how: DeliveryHow, orderHadTip = true): string {
  switch (how) {
    case 'staff-confirmed':
      return 'Confirmed by Foodz support';
    case 'admin-override':
      return 'Marked delivered by Foodz';
    case 'cancelled-after-pickup':
      return orderHadTip
        ? 'Cancelled after pickup. You still get the delivery fee. The tip went back to the customer with the refund.'
        : 'Cancelled after pickup. You still get the delivery fee.';
    case 'code':
    case 'demo':
    default:
      return 'Delivered with the code';
  }
}

/**
 * The sheet's pay rows (design 1.8): from the row at once, the detail's figures once read. A
 * cancellation after pickup shows "Tip · Not paid" only when the order had a tip (review P12).
 */
export function deliveryPayRows(
  row: Pick<EarningsRow, 'kind' | 'amountCents' | 'tipCents' | 'cashCents'>,
  detail: Pick<
    EarningsDeliveryDetail,
    'feeCents' | 'tipCents' | 'totalCents' | 'orderTipCents'
  > | null,
): { label: string; value: string; total?: true }[] {
  if (row.kind === 'cancelledAfterPickup') {
    const fee = formatPrice(row.amountCents);
    return [
      { label: 'Delivery pay', value: fee },
      ...(detail && detail.orderTipCents > 0 ? [{ label: 'Tip', value: 'Not paid' }] : []),
      { label: 'Total', value: fee, total: true as const },
    ];
  }
  const tip = row.tipCents ?? 0;
  return [
    { label: 'Delivery pay', value: formatPrice(detail?.feeCents ?? row.amountCents - tip) },
    { label: 'Tip', value: formatPrice(detail?.tipCents ?? tip) },
    {
      label: 'Total',
      value: formatPrice(detail?.totalCents ?? row.amountCents),
      total: true as const,
    },
    ...(row.cashCents ? [{ label: 'Cash collected', value: formatPrice(row.cashCents) }] : []),
  ];
}

export const STEPS_OFFLINE = "Steps show when you're back online.";
export const DELIVERY_NOT_FOUND = "This delivery isn't available.";

// ------------------------------------------------------------------ cash (1.3, 1.9)

export const KITCHEN_HAND_IN =
  "You've collected more cash than Foodz owes you. Hand it in at Foodz Kitchen, 88 Harbor Street.";

/** The cash card's heading and body (design 1.3's table). */
export function cashCardWords(cash: Pick<CashCard, 'state' | 'balanceCents' | 'holdingCents'>): {
  heading: string;
  body: string | null;
} {
  if (cash.state === 'owesYou') {
    return {
      heading: `Foodz owes you ${formatPrice(cash.balanceCents)}`,
      body:
        cash.holdingCents > 0
          ? `You're holding ${formatPrice(cash.holdingCents)} in customers' cash. It's taken off what Foodz pays you. ${PAYOUT_DAY_WORDS}`
          : PAYOUT_DAY_WORDS,
    };
  }
  if (cash.state === 'handIn') {
    return { heading: `Hand in ${formatPrice(-cash.balanceCents)}`, body: KITCHEN_HAND_IN };
  }
  return { heading: "You're all square.", body: null };
}

/** "Last payout: Mon, Nov 16 · $96.40" / "Since your first delivery: Mon, Nov 9". */
export function workedOutStart(breakdown: CashBreakdown, timeZone: string): string | null {
  if (!breakdown.fromAt || breakdown.from === 'none') return null;
  const day = shortDayAt(breakdown.fromAt, timeZone);
  if (breakdown.from === 'payout') {
    return `Last payout: ${day} · ${formatPrice(breakdown.payoutCents ?? 0)}`;
  }
  return `Since your first delivery: ${day}`;
}

/** The breakdown's rows, in order; "Carried over" only when a payout left a balance. */
export function workedOutRows(breakdown: CashBreakdown): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  if (breakdown.from === 'payout' && breakdown.carriedCents !== 0) {
    rows.push({
      label: 'Carried over',
      value:
        breakdown.carriedCents > 0
          ? formatPrice(breakdown.carriedCents)
          : signedPrice(breakdown.carriedCents),
    });
  }
  rows.push(
    { label: 'You earned', value: formatPrice(breakdown.earnedCents) },
    { label: 'Cash you collected', value: signedPrice(-breakdown.cashCollectedCents) },
    { label: 'Cash you handed in', value: signedPrice(breakdown.cashHandedInCents) },
  );
  return rows;
}

/** "= Foodz owes you" "$67.05"; spoken "Equals: Foodz owes you" then the amount. */
export function workedOutTotal(resultCents: number): {
  label: string;
  spokenLabel: string;
  value: string;
  spoken: string;
} {
  const value = formatPrice(Math.abs(resultCents));
  let words = "You're all square";
  if (resultCents > 0) words = 'Foodz owes you';
  else if (resultCents < 0) words = 'You hand in';
  const spokenLabel = `Equals: ${words}`;
  return {
    label: `= ${words}`,
    spokenLabel,
    value,
    spoken: resultCents === 0 ? spokenLabel : `${spokenLabel} ${value}`,
  };
}

/** "Offline · figures from 7:52 pm". */
export const offlineLine = (asOf: string, timeZone: string) =>
  `Offline · figures from ${clockAt(asOf, timeZone)}`;

// ------------------------------------------------------------------ Home and the delivered screen (1.11)

/** "Today · $19.57 · 3 deliveries", "Today · no deliveries yet". */
export function todayLine(today: TodayLine): string {
  if (today.deliveries === 0 && today.earnedCents === 0) return 'Today · no deliveries yet';
  return `Today · ${formatPrice(today.earnedCents)} · ${deliveriesWords(today.deliveries)}`;
}

/** Under "You earned $7.64": "Today: $19.57 · 3 deliveries". */
export const deliveredTodayLine = (today: TodayLine) =>
  `Today: ${formatPrice(today.earnedCents)} · ${deliveriesWords(today.deliveries)}`;

/** P57.3: "You'll still get the $2.64 delivery fee." */
export const keepsFeeSentence = (feeCents: number) =>
  `You'll still get the ${formatPrice(feeCents)} delivery fee.`;

// ------------------------------------------------------------------ ratings (1.12)

/**
 * His figure moves only once 5 new counted ratings have come in since the last update (the
 * security gate's S1), so no single rating can be worked out from one change to the next.
 */
export const RATINGS_UPDATE_WORDS = 'Updates after every 5 new ratings';
export const SHOWN_AT_FIVE = 'Customers see your rating once you have 5.';
export const TAGS_AT_FIVE = "We'll show what customers say once you have 5 ratings.";
export const TAGS_WINDOW = 'Tags show once 5 customers have rated you in the last 30 days.';

export const ratingsCount = (count: number) => plural(count, 'rating');

/** Profile's "Your ratings" row, second line. */
export function ratingsRowLine(rating: { average: number; count: number } | null): string {
  if (!rating || rating.count === 0) return 'No ratings yet';
  const figure = `${formatRating(rating.average)} · ${ratingsCount(rating.count)}`;
  return rating.count < 5 ? `${figure} · ${SHOWN_AT_FIVE}` : `${figure} · ${RATINGS_UPDATE_WORDS}`;
}

/** "Rated 4.5 out of 5 from 8 ratings, updates after every 5 new ratings". */
export function ratingsSentence(average: number, count: number): string {
  const base = `Rated ${formatRating(average)} out of 5 from ${ratingsCount(count)}`;
  return count < 5 ? base : `${base}, ${RATINGS_UPDATE_WORDS.toLowerCase()}`;
}

export const tagWords = (tag: string) => (isTag(tag) ? TAG_WORDS[tag] : tag);

/** "Friendly, picked 5 times". */
export const tagSentence = (tag: string, count: number) =>
  `${tagWords(tag)}, picked ${count === 1 ? 'once' : `${count} times`}`;

// ------------------------------------------------------------------ loading states (1.13)

export type LoadView = 'data' | 'skeleton' | 'offline' | 'error';

/**
 * What a read shows. A read paused for want of a connection never shows its skeleton forever
 * (P59.3): it says it loads when he's back online.
 */
export function loadView(read: { hasData: boolean; isError: boolean; paused: boolean }): LoadView {
  if (read.hasData) return 'data';
  if (read.isError) return 'error';
  if (read.paused) return 'offline';
  return 'skeleton';
}

/** The list stays out of the way when the week above already says it couldn't load (one block). */
export const listLoadView = (list: LoadView, week: LoadView): LoadView | 'hidden' =>
  week === 'error' || week === 'offline' ? 'hidden' : list;

/** The week names itself (QA U2): "This week", "Last week" or "Week of Nov 9 loads when…". */
export const weekOfflineLine = (start: IsoDate, currentStart: IsoDate) =>
  `${weekTitle(start, currentStart)} loads when you're back online.`;
export const LIST_OFFLINE = "Your deliveries load when you're back online.";

/**
 * Today with no entry ever (P59.1). An active partner is told how to start; a suspended one
 * (read-only, P61) can't go online, so he gets the heading alone, with Back in the header.
 */
export function noEarningsCopy(readOnly: boolean): {
  heading: string;
  line: string | null;
  homeAction: boolean;
} {
  return readOnly
    ? { heading: 'No earnings yet', line: null, homeAction: false }
    : {
        heading: 'No earnings yet',
        line: 'Go online to get your first order. Your pay for each delivery shows up here.',
        homeAction: true,
      };
}
