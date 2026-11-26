import { clockTime } from '@/lib/account-text';
import { formatPrice } from '@/lib/format';
import { firstNameOf, shortName } from '@/server/modules/delivery/text';
import type { EarningKind, EntryReason, LedgerRow, PayoutMethod } from './schema';

/*
 * F9's earnings words built on the server (contract §2, §11): the staff ledger's entry words,
 * who recorded an entry, the conflict sentences of the money dialogs, the board notices and the
 * partner's notices. Partners only ever read "Foodz" or "Foodz support" (P60.3).
 */

export const METHOD_WORDS: Record<PayoutMethod, string> = {
  'bank-transfer': 'Bank transfer',
  'cash-at-kitchen': 'Cash at the kitchen',
  other: 'Other',
};

const REASON_WORDS: Partial<Record<EntryReason, string>> = {
  'cancelled-order-pay': 'Pay for a cancelled order',
  correction: 'Correction',
  other: 'Other',
};

/** A signed amount with a real minus sign: "+$3.00", "−$58.97" (design 0). */
export function signedPrice(cents: number): string {
  if (cents === 0) return formatPrice(0);
  return `${cents > 0 ? '+' : '−'}${formatPrice(Math.abs(cents))}`;
}

/** The staff ledger's words for an entry (design 3.5). */
export function entryWords(
  kind: EarningKind,
  reason: EntryReason | null,
  amountCents: number,
  method: PayoutMethod | null,
): string {
  switch (kind) {
    case 'DELIVERY_FEE':
      return reason === 'cancelled-after-pickup'
        ? 'Delivery fee · cancelled after pickup'
        : 'Delivery fee';
    case 'TIP':
      return 'Tip';
    case 'CASH_COLLECTED':
      return 'Cash collected';
    case 'CASH_HANDED_IN':
      return 'Cash handed in';
    case 'BONUS':
      return 'Bonus';
    case 'ADJUSTMENT': {
      const direction = amountCents > 0 ? 'Added' : 'Taken off';
      const why = (reason && REASON_WORDS[reason]) ?? 'Other';
      return `${direction} · ${why}`;
    }
    case 'PAYOUT':
    default:
      return `Payout · ${method ? METHOD_WORDS[method] : 'Other'}`;
  }
}

const ROLE_WORDS = { support: 'Support', admin: 'Admin' } as const;

/** "Foodz (automatic)" or "Morgan Diaz (Support)" (A59.2). */
export function recordedByWords(recordedBy: LedgerRow['recordedBy']): string {
  if (recordedBy.kind === 'system') return 'Foodz (automatic)';
  return `${recordedBy.name} (${ROLE_WORDS[recordedBy.role]})`;
}

/** The CSV's "Recorded by": the role, never a person (A64.4). */
export function recordedByRole(recordedBy: LedgerRow['recordedBy']): string {
  return recordedBy.kind === 'system' ? 'Foodz (automatic)' : ROLE_WORDS[recordedBy.role];
}

// ------------------------------------------------------------------ conflicts (A62.3, A67.2)

/**
 * A time from a database function's jsonb answer. `occurred_at` is a timestamp without time
 * zone holding UTC, and jsonb writes it without an offset ("2026-11-26T19:08:00"), which
 * `new Date` would read as the server's local time: read it as UTC.
 */
export function utcInstant(value: string): Date {
  return new Date(/(?:z|[+-]\d{2}(?::?\d{2})?)$/i.test(value) ? value : `${value}Z`);
}

export interface LatestEntry {
  kind: EarningKind;
  amountCents: number;
  reason: EntryReason | null;
  at: string;
  orderNumber: string | null;
  byName: string | null;
}

/** What happened since the dialog opened, as one sentence. */
export function latestEntryWords(
  latest: LatestEntry,
  partnerName: string,
  timeZone: string,
): string {
  const first = firstNameOf(partnerName);
  const at = clockTime(utcInstant(latest.at), timeZone);
  const by = latest.byName ?? 'Foodz';
  const amount = formatPrice(Math.abs(latest.amountCents));
  switch (latest.kind) {
    case 'DELIVERY_FEE':
    case 'TIP':
    case 'CASH_COLLECTED':
      return latest.reason === 'cancelled-after-pickup'
        ? `Order ${latest.orderNumber ?? ''} was cancelled after pickup at ${at}.`
        : `${first} delivered order ${latest.orderNumber ?? ''} at ${at}.`;
    case 'CASH_HANDED_IN':
      return `${by} recorded ${amount} in cash from ${first} at ${at}.`;
    case 'PAYOUT':
      return `${by} recorded a payout of ${amount} for ${first} at ${at}.`;
    case 'ADJUSTMENT':
      return latest.amountCents < 0
        ? `${by} took ${amount} off ${first}'s earnings at ${at}.`
        : `${by} added ${amount} to ${first}'s earnings at ${at}.`;
    case 'BONUS':
    default:
      return `${by} added ${amount} to ${first}'s earnings at ${at}.`;
  }
}

/** The figures-changed alert, or the payout race's close-only line (design 3.9, conflict 7). */
export function ledgerChangedWords(options: {
  latest: LatestEntry | null;
  partnerName: string;
  balanceCents: number;
  holdingCents: number;
  closeOnly: boolean;
  timeZone: string;
}): string {
  const first = firstNameOf(options.partnerName);
  const what = options.latest
    ? latestEntryWords(options.latest, options.partnerName, options.timeZone)
    : `${first}'s figures changed.`;
  if (!options.closeOnly)
    return `The figures changed after you opened this: ${what} Check the amount.`;
  if (options.latest?.kind === 'PAYOUT' || options.balanceCents <= 0) {
    if (options.latest?.kind === 'PAYOUT') {
      return `${what} ${first}'s balance is now ${formatPrice(options.balanceCents)}.`;
    }
    return `Foodz doesn't owe ${first} anything right now.`;
  }
  return `${first} isn't holding any cash.`;
}

// ------------------------------------------------------------------ notices

export function boardNotice(kind: EarningKind, amountCents: number, partnerName: string): string {
  const name = shortName(partnerName);
  const ending = name.endsWith('.') ? '' : '.';
  const amount = formatPrice(Math.abs(amountCents));
  switch (kind) {
    case 'CASH_HANDED_IN':
      return `Recorded ${amount} in cash from ${name}${ending}`;
    case 'PAYOUT':
      return `Recorded a payout of ${amount} to ${name}${ending}`;
    case 'ADJUSTMENT':
      if (amountCents < 0) return `Took ${amount} off ${name}'s earnings.`;
      return `Added ${amount} to ${name}'s earnings.`;
    default:
      return `Added ${amount} to ${name}'s earnings.`;
  }
}

export const PARTNER_NOTICE_BODY = 'Your balance is updated in Earnings.';

export type EarningsNoticeType =
  | 'earnings.cash-recorded'
  | 'earnings.adjusted'
  | 'earnings.payout-recorded';

/** A60.3, A61.2, A62.2: never a staff member's name or note. */
export function partnerNotice(entry: {
  kind: EarningKind;
  amountCents: number;
  message: string | null;
  method: PayoutMethod | null;
}): { type: EarningsNoticeType; title: string; body: string } {
  const amount = formatPrice(Math.abs(entry.amountCents));
  if (entry.kind === 'CASH_HANDED_IN') {
    return {
      type: 'earnings.cash-recorded',
      title: `Foodz recorded ${amount} in cash from you.`,
      body: PARTNER_NOTICE_BODY,
    };
  }
  if (entry.kind === 'PAYOUT') {
    return {
      type: 'earnings.payout-recorded',
      title: `Foodz paid you ${amount} · ${entry.method ? METHOD_WORDS[entry.method] : 'Other'}`,
      body: PARTNER_NOTICE_BODY,
    };
  }
  const verb = entry.amountCents < 0 ? 'took off' : 'added';
  const title = `Foodz ${verb} ${amount}: ${entry.message ?? ''}`.trim();
  return { type: 'earnings.adjusted', title: title.slice(0, 120), body: PARTNER_NOTICE_BODY };
}

/** "Deleted partner · 1a2b" (E10.1). */
export const deletedPartnerName = (partnerId: string) =>
  `Deleted partner · ${partnerId.replaceAll('-', '').slice(0, 4)}`;

/** "Hana K." for staff; "Deleted customer" once the account is gone (V9.1). */
export function customerShort(name: string | null, deleted: boolean): string {
  if (deleted || !name) return 'Deleted customer';
  return shortName(name);
}
