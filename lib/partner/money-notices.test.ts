import { beforeEach, describe, expect, it } from 'vitest';
import type { NotificationCreatedEvent } from '@/lib/realtime/events';
import {
  addMoneyNotice,
  dismissMoneyNotice,
  moneyNoticeOf,
  moneyNoticeStore,
  moneyNoticeTone,
} from './money-notices';

const event = (overrides: Partial<NotificationCreatedEvent>): NotificationCreatedEvent =>
  ({
    id: 'n1',
    title: 'Foodz recorded $142.70 in cash from you.',
    body: 'Your balance is updated in Earnings.',
    link: '/partner/earnings',
    kind: 'partner',
    type: 'earnings.cash-recorded',
    ...overrides,
  }) as NotificationCreatedEvent;

describe('staff money notices on the partner phone (design 1.10)', () => {
  beforeEach(() => moneyNoticeStore.setState(() => ({ items: [] })));

  it('reads each earnings notification as its kind, with the server title', () => {
    expect(moneyNoticeOf(event({}))).toEqual({
      id: 'n1',
      kind: 'cash',
      text: 'Foodz recorded $142.70 in cash from you.',
    });
    expect(
      moneyNoticeOf(
        event({ type: 'earnings.adjusted', title: 'Foodz added $3.00: Waited 20 min.' }),
      )?.kind,
    ).toBe('added');
    expect(
      moneyNoticeOf(event({ type: 'earnings.adjusted', title: 'Foodz took off $2.00: Wrong tip.' }))
        ?.kind,
    ).toBe('takenOff');
    expect(
      moneyNoticeOf(event({ type: 'earnings.payout-recorded', title: 'Foodz paid you $67.05' }))
        ?.kind,
    ).toBe('payout');
  });

  it('ignores every other notification', () => {
    expect(moneyNoticeOf(event({ type: 'partner.suspended' }))).toBeNull();
    expect(
      moneyNoticeOf({ id: 'g', title: 'Hi', body: '', link: null, kind: 'general' }),
    ).toBeNull();
  });

  it('shows a take-off as news, not a success', () => {
    expect(moneyNoticeTone('takenOff')).toBe('muted');
    expect(moneyNoticeTone('payout')).toBe('success');
  });

  it('keeps a notice until dismissed and never adds the same one twice', () => {
    const notice = {
      id: 'n1',
      kind: 'cash' as const,
      text: 'Foodz recorded $1.00 in cash from you.',
    };
    expect(addMoneyNotice(notice)).toBe(true);
    expect(addMoneyNotice(notice)).toBe(false);
    expect(moneyNoticeStore.state.items).toHaveLength(1);
    dismissMoneyNotice('n1');
    expect(moneyNoticeStore.state.items).toEqual([]);
  });
});
