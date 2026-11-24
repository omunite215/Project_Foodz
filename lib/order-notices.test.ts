import { describe, expect, it } from 'vitest';
import type { NotificationCreatedEvent } from '@/lib/realtime/events';
import {
  dismissNoticeName,
  MAX_ORDER_NOTICES,
  NOTICE_VISIBLE_MS,
  noticeFrom,
  noticeHiddenOn,
  orderNoticesReducer,
  viewOrderName,
} from './order-notices';

const event = (
  orderId: string,
  status: 'accepted' | 'ready' | 'cancelled' = 'accepted',
  id = `${orderId}-${status}`,
): NotificationCreatedEvent => ({
  id,
  title: `Order ${orderId} ${status}`,
  body: 'The kitchen has your order and will start cooking soon.',
  link: `/orders/${orderId}`,
  kind: 'order',
  orderId,
  orderNumber: orderId,
  status,
});

describe('order notices (F5 design 9)', () => {
  it('reads only order notifications', () => {
    expect(noticeFrom({ id: 'n', title: 't', body: 'b', link: null, kind: 'general' })).toBeNull();
    expect(noticeFrom(event('1042'))).toMatchObject({
      orderNumber: '1042',
      leftMs: NOTICE_VISIBLE_MS,
    });
    // Cancellations stay until dismissed.
    expect(noticeFrom(event('1042', 'cancelled'))?.leftMs).toBeNull();
  });

  it('keeps one notice per order, replacing its text in place', () => {
    const first = orderNoticesReducer([], { type: 'received', event: event('1042') });
    const second = orderNoticesReducer(first, { type: 'received', event: event('1043') });
    const replaced = orderNoticesReducer(second, {
      type: 'received',
      event: event('1042', 'ready'),
    });
    expect(replaced.map((notice) => `${notice.orderId}:${notice.status}`)).toEqual([
      '1042:ready',
      '1043:accepted',
    ]);
  });

  it('shows three at most, the oldest leaving first', () => {
    let notices = orderNoticesReducer([], { type: 'received', event: event('1') });
    for (const id of ['2', '3', '4']) {
      notices = orderNoticesReducer(notices, { type: 'received', event: event(id) });
    }
    expect(notices).toHaveLength(MAX_ORDER_NOTICES);
    expect(notices.map((notice) => notice.orderId)).toEqual(['2', '3', '4']);
  });

  it('lets step notices go after 10 seconds of visible time, and keeps cancellations', () => {
    let notices = orderNoticesReducer([], { type: 'received', event: event('1042') });
    notices = orderNoticesReducer(notices, { type: 'received', event: event('1043', 'cancelled') });
    notices = orderNoticesReducer(notices, { type: 'elapsed', ms: 9_000 });
    expect(notices).toHaveLength(2);
    notices = orderNoticesReducer(notices, { type: 'elapsed', ms: 1_000 });
    expect(notices.map((notice) => notice.orderId)).toEqual(['1043']);
    expect(orderNoticesReducer(notices, { type: 'dismissed', orderId: '1043' })).toEqual([]);
  });

  it('stays off the order’s own page and the orders list', () => {
    expect(noticeHiddenOn('/orders/abc', 'abc')).toBe(true);
    expect(noticeHiddenOn('/account/orders', 'abc')).toBe(true);
    expect(noticeHiddenOn('/menu', 'abc')).toBe(false);
    expect(noticeHiddenOn('/orders/other', 'abc')).toBe(false);
  });

  it('names its buttons with the order', () => {
    expect(viewOrderName('1042')).toBe('View order 1042');
    expect(dismissNoticeName('1042')).toBe('Dismiss notice about order 1042');
  });
});
