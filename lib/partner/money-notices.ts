import { createStore } from '@tanstack/react-store';
import type { NotificationCreatedEvent, PartnerNoticeType } from '@/lib/realtime/events';

/*
 * Staff money notices on the partner's phone (F9 design 1.10): Foodz recorded cash, added or
 * took off an amount, or paid him. Each stays in the notice slot of whichever app screen shows
 * until he dismisses it, across screens, and is read once. The words are the server's title,
 * which never names a staff member or carries a note (P60.3).
 */

export const EARNINGS_NOTICE_TYPES = [
  'earnings.cash-recorded',
  'earnings.adjusted',
  'earnings.payout-recorded',
] as const satisfies readonly PartnerNoticeType[];
export type EarningsNoticeType = (typeof EARNINGS_NOTICE_TYPES)[number];

const isEarningsType = (type: string): type is EarningsNoticeType =>
  (EARNINGS_NOTICE_TYPES as readonly string[]).includes(type);

export type MoneyNoticeKind = 'cash' | 'added' | 'takenOff' | 'payout';

export interface MoneyNotice {
  id: string;
  kind: MoneyNoticeKind;
  text: string;
}

/** What kind of money notice an event is, or null for any other notification. */
export function moneyNoticeOf(event: NotificationCreatedEvent): MoneyNotice | null {
  if (event.kind !== 'partner' || !isEarningsType(event.type)) return null;
  let kind: MoneyNoticeKind = 'added';
  if (event.type === 'earnings.cash-recorded') kind = 'cash';
  else if (event.type === 'earnings.payout-recorded') kind = 'payout';
  else if (event.title.startsWith('Foodz took off')) kind = 'takenOff';
  return { id: event.id, kind, text: event.title };
}

/** A take-off is news, not a success: the muted tone (design 1.10's table). */
export const moneyNoticeTone = (kind: MoneyNoticeKind) =>
  kind === 'takenOff' ? 'muted' : 'success';

export const moneyNoticeStore = createStore<{ items: MoneyNotice[] }>({ items: [] });

/** Adds a notice once (a repeat of the same event is ignored); true when it's new. */
export function addMoneyNotice(notice: MoneyNotice): boolean {
  if (moneyNoticeStore.state.items.some((item) => item.id === notice.id)) return false;
  moneyNoticeStore.setState((state) => ({ items: [notice, ...state.items].slice(0, 4) }));
  return true;
}

export function dismissMoneyNotice(id: string) {
  moneyNoticeStore.setState((state) => ({
    items: state.items.filter((item) => item.id !== id),
  }));
}
