import type {
  LedgerRow,
  PartnerBalance,
  PartnerEarningsPage,
  PartnerListMoney,
  PayoutMethod,
} from '@/server/modules/earnings/schema';
import { EARNINGS_LIMITS } from '@/server/modules/earnings/schema';
import {
  entryWords,
  METHOD_WORDS,
  recordedByWords,
  signedPrice,
} from '@/server/modules/earnings/text';
import { storeDate } from '@/server/modules/partners/text';
import {
  type ExcludeReason,
  RATING_RULES,
  type StaffOrderFeedback,
  type StaffRatingRow,
  TAG_WORDS,
  type TagCount,
} from '@/server/modules/ratings/schema';
import { dateTime, dayOf, monthDay, weekdayShort } from '@/lib/partner-review/text';
import { formatPrice, plural } from '@/lib/format';
import { starsCount } from '@/lib/rating-text';

/*
 * F9's staff words for the Partners list, the partner page's Earnings and Ratings sections, the
 * money dialogs and the order's feedback (design 3.2 to 3.11, 3.16, "Copy"). Pure functions:
 * every figure comes from the server in cents; the only sums here are a dialog's preview of a
 * typed amount, in integer cents. Staff copy never says "he" or "she" (F6 D2).
 */

export const HIDDEN_FOR_DEMO = 'Hidden for demo staff';
export const READ_ONLY_DEMO = 'Read-only in the demo';

const firstOf = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** A balance with a real minus sign and no plus: "$67.05", "−$142.70". */
export function balanceText(cents: number): string {
  return cents < 0 ? `−${formatPrice(-cents)}` : formatPrice(cents);
}

export { signedPrice };

// ------------------------------------------------------------------ the Partners list (3.2)

export interface RatingCellWords {
  /** "4.6 · 31", or "—". */
  text: string;
  /** "not shown to customers yet" under 5 counted ratings. */
  second: string | null;
  /** What a screen reader hears in place of "—". */
  sr: string | null;
}

export function ratingCell(rating: PartnerListMoney['rating']): RatingCellWords {
  if (!rating || rating.count === 0) return { text: '—', second: null, sr: 'No ratings' };
  return {
    text: `${rating.average.toFixed(1)} · ${rating.count}`,
    second: rating.shownToCustomers ? null : 'not shown to customers yet',
    sr: null,
  };
}

/** "18 deliveries" and "$126.02", each kept whole; null for no week. */
export function weekCell(week: PartnerListMoney['week']): [string, string] | null {
  if (!week) return null;
  return [plural(week.deliveries, 'delivery', 'deliveries'), formatPrice(week.earnedCents)];
}

/** Whole calendar days in the store's zone from `since` to `now`. */
function storeDaysAgo(since: string, now: Date, timeZone: string): number {
  const from = Date.parse(`${storeDate(since, timeZone)}T00:00:00Z`);
  const to = Date.parse(`${storeDate(now, timeZone)}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

/** "since Tue" within 6 days, then "since Nov 9"; spoken "since Tuesday" (design 3.2). */
export function sinceWords(
  since: string,
  now: Date,
  timeZone: string,
): { text: string; spoken: string } {
  const date = storeDate(since, timeZone);
  if (storeDaysAgo(since, now, timeZone) <= 6) {
    const short = weekdayShort(date).split(',')[0] ?? '';
    const long = new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
      timeZone: 'UTC',
      weekday: 'long',
    });
    return { text: `since ${short}`, spoken: `since ${long}` };
  }
  return { text: `since ${monthDay(date)}`, spoken: `since ${monthDay(date)}` };
}

export interface CashBlockWords {
  tone: 'plain' | 'amber';
  /** "Owes $142.70 · since Tue". */
  text: string;
  /** "Owes Foodz $142.70, since Tuesday". */
  spoken: string;
}

/**
 * The cash cell (A57.1, conflict 11): the amber case always carries a word the plain one
 * lacks, "since Tue" (owed over 48 hours) or "over $150".
 */
export function cashBlock(
  cash: NonNullable<PartnerListMoney['cash']>,
  now: Date,
  timeZone: string,
): CashBlockWords {
  const amount = formatPrice(cash.owedCents);
  if (!cash.amber) {
    return { tone: 'plain', text: `Owes ${amount}`, spoken: `Owes Foodz ${amount}` };
  }
  if (cash.why.includes('age')) {
    const since = sinceWords(cash.since, now, timeZone);
    return {
      tone: 'amber',
      text: `Owes ${amount} · ${since.text}`,
      spoken: `Owes Foodz ${amount}, ${since.spoken}`,
    };
  }
  // Whole dollars, as the design writes it: "over $150".
  const limit = `$${Math.round(EARNINGS_LIMITS.cashAmberCents / 100)}`;
  return {
    tone: 'amber',
    text: `Owes ${amount} · over ${limit}`,
    spoken: `Owes Foodz ${amount}, over ${limit}`,
  };
}

export const notHoldingCash = (name: string) => `${firstOf(name)} isn't holding any cash.`;
export const moreActionsName = (name: string) => `More actions for ${name}`;
export const NO_PARTNERS_OWE = 'No partners owe cash.';

// ------------------------------------------------------------------ the partner page (3.3, 3.4)

export type PartnerSection = 'earnings' | 'ratings' | 'application';
export const PARTNER_SECTIONS: readonly PartnerSection[] = ['earnings', 'ratings', 'application'];
export const SECTION_LABELS: Record<PartnerSection, string> = {
  earnings: 'Earnings',
  ratings: 'Ratings',
  application: 'Application',
};
export const SECTION_TITLES: Record<PartnerSection, string> = {
  earnings: 'Partner earnings',
  ratings: 'Partner ratings',
  application: 'Partner application',
};

/** `?view=` read leniently: anything else is Earnings. */
export const sectionOf = (value: string | undefined | null): PartnerSection =>
  value === 'ratings' || value === 'application' ? value : 'earnings';

/** "Foodz owes Luis $67.05" / "Diego owes Foodz $142.70 in cash · since Tue, Nov 17" / "All square". */
export function balanceHeading(balance: PartnerBalance, name: string, timeZone: string): string {
  const first = firstOf(name);
  if (balance.state === 'foodzOwes')
    return `Foodz owes ${first} ${formatPrice(balance.balanceCents)}`;
  if (balance.state === 'partnerOwes') {
    const amount = formatPrice(-balance.balanceCents);
    const since = balance.owedSince ? ` · since ${dayOf(balance.owedSince, timeZone)}` : '';
    return `${first} owes Foodz ${amount} in cash${since}`;
  }
  return 'All square';
}

export const holdingLine = (cents: number) =>
  cents > 0 ? `Holding ${formatPrice(cents)} in customers' cash` : null;

/** "Mon, Nov 16 – Sun, Nov 22" (U+2013 with spaces). */
export const dayRange = (from: string, to: string) => `${weekdayShort(from)} – ${weekdayShort(to)}`;

export const weekHeading = (start: string, end: string) => `This week · ${dayRange(start, end)}`;

/** "Last payout: Mon, Nov 16 · $96.40 · Bank transfer · Week of Nov 9" / "No payouts yet." */
export function lastPayoutLine(lastPayout: PartnerEarningsPage['lastPayout']): string {
  if (!lastPayout) return 'No payouts yet.';
  const parts = [
    `Last payout: ${weekdayShort(lastPayout.paidOn)}`,
    formatPrice(lastPayout.amountCents),
    METHOD_WORDS[lastPayout.method],
  ];
  if (lastPayout.reference) parts.push(lastPayout.reference);
  return parts.join(' · ');
}

/** "Fri, Nov 20 · 7:46 pm". */
export const ledgerWhen = (at: string, timeZone: string) => dateTime(at, timeZone);

export const ledgerEntryWords = (row: LedgerRow) =>
  entryWords(row.kind, row.reason, row.amountCents, row.method);

/** The Entry cell's second lines: the partner's message in quotes, the payout reference, the note. */
export function ledgerDetails(row: LedgerRow): string[] {
  const lines: string[] = [];
  if (row.message) lines.push(`“${row.message}”`);
  if (row.kind === 'PAYOUT') {
    const parts = [
      row.reference ? `Reference: ${row.reference}` : null,
      row.paidOn ? `paid ${weekdayShort(row.paidOn)}` : null,
    ].filter(Boolean);
    if (parts.length) lines.push(parts.join(' · '));
  }
  if (row.staffNote) lines.push(`Note: ${row.staffNote}`);
  return lines;
}

export const ledgerRecordedBy = (row: LedgerRow) => recordedByWords(row.recordedBy);

/** "Nov 16 to Nov 22". */
export const rangeWords = (from: string, to: string) => `${monthDay(from)} to ${monthDay(to)}`;

/** "Luis Moreno's entries, Nov 16 to Nov 22, newest first, 23 entries". */
export function ledgerCaption(
  name: string,
  range: { from: string; to: string },
  dir: 'asc' | 'desc',
  total: number,
): string {
  return `${name}'s entries, ${rangeWords(range.from, range.to)}, ${
    dir === 'desc' ? 'newest first' : 'oldest first'
  }, ${plural(total, 'entry', 'entries')}`;
}

/** The ledger pager: "Showing 1–23 of 23". */
export function showingEntries(page: number, pageSize: number, total: number): string {
  if (total === 0) return 'Showing 0 of 0';
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  return `Showing ${first}–${last} of ${total}`;
}

/** " for Luis Moreno, Nov 16 to Nov 22", after the visible "Download entries (CSV)". */
export const entriesCsvSuffix = (name: string, from: string, to: string) =>
  `for ${name}, ${rangeWords(from, to)}`;

/** No person's name in the file (B11). */
export const entriesFileName = (from: string, to: string) =>
  `foodz-partner-entries-${from}-to-${to}.csv`;

export const RANGE_ERRORS = {
  date: 'Enter a date.',
  order: "The end date can't be before the start.",
  length: "The range can't be longer than 366 days.",
} as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The ledger's From and To (design 3.5): each error under its input. */
export function rangeProblems(from: string, to: string): { from?: string; to?: string } {
  const problems: { from?: string; to?: string } = {};
  if (!ISO_DATE.test(from)) problems.from = RANGE_ERRORS.date;
  if (!ISO_DATE.test(to)) problems.to = RANGE_ERRORS.date;
  if (problems.from || problems.to) return problems;
  const days = Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );
  if (days < 0) problems.to = RANGE_ERRORS.order;
  else if (days + 1 > EARNINGS_LIMITS.rangeMaxDays) problems.to = RANGE_ERRORS.length;
  return problems;
}

// ------------------------------------------------------------------ money dialogs (3.6 to 3.9)

export const MONEY_COPY = {
  smartphone: (name: string) => `${firstOf(name)} will see this in the app straight away.`,
  cashFinal: "It can't be edited or deleted. An admin corrects mistakes with an adjustment.",
  adjustFinal: "It can't be edited or deleted. Correct it with another adjustment.",
  payoutFinal: "It can't be edited or deleted.",
  payoutInfo: "This records a payment you've already made. Foodz doesn't send money from here.",
  checking: 'Checking for changes…',
  offline: "You're offline.",
  stepUpHint: "We ask for a code before changing a partner's money, at most every 10 minutes.",
  stepUpPrompt: 'Enter a code from your authenticator app to continue.',
  amount: 'Enter an amount like 12.50.',
  amountMin: 'Enter at least $0.01.',
  adjustCap: 'Adjustments are limited to $500 each.',
  reason: 'Choose a reason.',
  method: 'Choose how you paid.',
  futureDate: "The date can't be in the future.",
  date: 'Enter a date.',
} as const;

export const cashTitle = (name: string) => `Record cash from ${name}`;
export const adjustTitle = (name: string) => `Adjust ${name}'s earnings`;
export const payoutTitle = (name: string) => `Record a payout to ${name}`;

export const holdingHint = (name: string, holdingCents: number) =>
  `${firstOf(name)} is holding ${formatPrice(holdingCents)} in customers' cash.`;
export const overHolding = (name: string, holdingCents: number) =>
  `${firstOf(name)} is holding ${formatPrice(holdingCents)}, so enter ${formatPrice(holdingCents)} or less.`;
export const overBalance = (name: string, balanceCents: number) =>
  `Foodz owes ${firstOf(name)} ${formatPrice(balanceCents)}, so enter ${formatPrice(balanceCents)} or less.`;

export const messageLabel = (name: string) => `Message for ${firstOf(name)}`;
export const messageHint = (name: string) =>
  `${firstOf(name)} reads this exactly as you type it, in the app. For example: Waited 20 min at the kitchen for order 1050.`;
export const messageMissing = (name: string) => `Write a message for ${firstOf(name)}.`;
export const orderHint = (name: string) => `An order ${firstOf(name)} had.`;

/** What a balance will be after the typed amount, as one sentence (unannounced, A60.2). */
function afterWords(name: string, afterCents: number): string {
  const first = firstOf(name);
  if (afterCents > 0) return `After this, Foodz will owe ${first} ${formatPrice(afterCents)}.`;
  if (afterCents === 0) return `After this, ${first} is all square.`;
  return `After this, ${first} will owe Foodz ${formatPrice(-afterCents)}.`;
}

/** Record cash: "After this, Diego still owes $42.70." and the never-edited line. */
export function cashOutcome(
  name: string,
  balanceCents: number,
  amountCents: number | null,
): string[] {
  if (amountCents === null) return [MONEY_COPY.cashFinal];
  const after = balanceCents + amountCents;
  const first = firstOf(name);
  const line =
    after < 0 ? `After this, ${first} still owes ${formatPrice(-after)}.` : afterWords(name, after);
  return [line, MONEY_COPY.cashFinal];
}

export const cashActionLabel = (amountCents: number | null) =>
  amountCents === null ? 'Record cash' : `Record ${formatPrice(amountCents)}`;

export type AdjustDirection = 'add' | 'take-off';

/** "Luis will see: Foodz added $3.00: …", the balance after, and the never-edited line. */
export function adjustOutcome(
  name: string,
  direction: AdjustDirection,
  amountCents: number | null,
  message: string,
  balanceCents: number,
): string[] {
  const lines: string[] = [];
  if (amountCents !== null) {
    const verb = direction === 'add' ? 'added' : 'took off';
    const said = message.trim();
    lines.push(
      `${firstOf(name)} will see: Foodz ${verb} ${formatPrice(amountCents)}${said ? `: ${said}` : '.'}`,
    );
    lines.push(afterWords(name, balanceCents + (direction === 'add' ? amountCents : -amountCents)));
  }
  lines.push(MONEY_COPY.adjustFinal);
  return lines;
}

export function adjustActionLabel(direction: AdjustDirection, amountCents: number | null) {
  const verb = direction === 'add' ? 'Add' : 'Take off';
  return amountCents === null ? verb : `${verb} ${formatPrice(amountCents)}`;
}

/** "Luis will see: Foodz paid you $67.05 · Bank transfer", the balance after, the final line. */
export function payoutOutcome(
  name: string,
  method: PayoutMethod | null,
  amountCents: number | null,
  balanceCents: number,
): string[] {
  const lines: string[] = [];
  if (amountCents !== null) {
    const how = method ? ` · ${METHOD_WORDS[method]}` : '';
    lines.push(`${firstOf(name)} will see: Foodz paid you ${formatPrice(amountCents)}${how}`);
    lines.push(
      `After this, Foodz will owe ${firstOf(name)} ${balanceText(balanceCents - amountCents)}.`,
    );
  }
  lines.push(MONEY_COPY.payoutFinal);
  return lines;
}

export const payoutActionLabel = (amountCents: number | null) =>
  amountCents === null ? 'Record payout' : `Record ${formatPrice(amountCents)} payout`;

/** Cents to the amount field's starting text: 14270 → "142.70". */
export const amountText = (cents: number | null) =>
  cents === null || cents <= 0 ? '' : (cents / 100).toFixed(2);

// ------------------------------------------------------------------ ratings (3.10, 3.11)

export const ratingsCount = (count: number) => plural(count, 'rating');

export const shownWords = (shown: boolean) =>
  shown
    ? 'Shown to customers'
    : `Not shown to customers until ${RATING_RULES.courierShownAt} ratings`;

/** After the gate's S1 fix the partner's own figure moves only after 5 new ratings. */
export const appFigureLine = (name: string) =>
  `${firstOf(name)}'s app updates this figure after every ${RATING_RULES.courierShownAt} new ratings.`;

export const baselineLine = (count: number) =>
  `Includes ${count} earlier ${count === 1 ? 'rating' : 'ratings'} without details (sample data).`;

export const SPREAD_NOTE = 'Spread and tags count rated deliveries only.';

/** "5 stars: 5 ratings". */
export const spreadSr = (stars: number, count: number) =>
  `${starsCount(stars)}: ${ratingsCount(count)}`;

/** "Friendly · 5"; a tag the list doesn't know reads as it came. */
export function tagChip(tag: TagCount): string {
  return `${tagWord(tag.tag)} · ${tag.count}`;
}

export function tagWord(tag: string): string {
  return (TAG_WORDS as Record<string, string | undefined>)[tag] ?? tag;
}

export function excludeReasonLabels(kind: 'dish' | 'courier'): Record<ExcludeReason, string> {
  return {
    abusive: 'Abusive or discriminatory',
    'wrong-subject':
      kind === 'courier' ? 'About the food, not the courier' : 'About the courier, not the food',
    'test-or-duplicate': 'Test or duplicate',
    other: 'Other',
  };
}

/** "Excluded · About the food, not the courier · Morgan Diaz". */
export function excludedLine(row: StaffRatingRow): string | null {
  if (!row.excluded) return null;
  return `Excluded · ${excludeReasonLabels(row.kind)[row.excluded.reason]} · ${row.excluded.byName}`;
}

/** "Tue, Nov 17 · 7:20 pm". */
export const ratingWhen = (row: StaffRatingRow, timeZone: string) => dateTime(row.at, timeZone);

/** "Exclude from average: 3 stars, Tue, Nov 17, order S2205" (visible words first). */
export function excludeButtonName(row: StaffRatingRow, timeZone: string, include = false): string {
  const verb = include ? 'Include again' : 'Exclude from average';
  return `${verb}: ${starsCount(row.stars)}, ${dayOf(row.at, timeZone)}, order ${row.orderNumber}`;
}

export function excludeTitle(row: Pick<StaffRatingRow, 'kind' | 'subject'>): string {
  return row.kind === 'dish'
    ? `Exclude this ${row.subject} rating from the dish's average?`
    : `Exclude this rating from ${row.subject}'s average?`;
}

export function excludeOutcome(row: Pick<StaffRatingRow, 'kind' | 'subject'>): string[] {
  return [
    row.kind === 'dish'
      ? `It stops counting toward ${row.subject}'s rating on the menu within a minute.`
      : `It stops counting toward ${firstOf(row.subject)}'s average and tag counts within a minute.`,
    "The customer isn't told and still sees their own stars.",
    'You can include it again later.',
  ];
}

/** The read-only box's comment: the first 200 characters, then "…". */
export function commentPreview(comment: string | null): string | null {
  if (!comment) return null;
  const chars = Array.from(comment);
  return chars.length > 200 ? `${chars.slice(0, 200).join('')}…` : comment;
}

export const showingRatings = (shown: number, total: number) => `Showing ${shown} of ${total}`;

// ------------------------------------------------------------------ the order's feedback (3.16)

/** The state line when there's nothing to list, or null when ratings are listed. */
export function feedbackStateLine(
  feedback: Pick<StaffOrderFeedback, 'state' | 'closesAt'>,
  timeZone: string,
): string | null {
  switch (feedback.state) {
    case 'open':
      return feedback.closesAt
        ? `Not rated yet · closes ${dayOf(feedback.closesAt, timeZone)}`
        : 'Not rated yet';
    case 'skipped':
      return 'Skipped by the customer';
    case 'closed':
      return 'Rating closed';
    case 'cancelled':
      return 'No ratings for cancelled orders';
    default:
      return null;
  }
}

export const courierFeedbackName = (name: string) => `${name} · courier`;
export const notRatedLine = (title: string) => `${title} · not rated`;
export const dishLine = (title: string, quantity: number) =>
  quantity > 1 ? `${title} × ${quantity}` : title;
