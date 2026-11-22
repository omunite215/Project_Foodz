'use client';

import { useQuery } from '@tanstack/react-query';
import { listOrdersAction } from '@/server/modules/orders/actions';
import { callAction } from '@/lib/action-result';

/** The order waiting for its card payment, if any: the cart says so first (F4 S7.6, design 1.3). */
export interface UnpaidOrderNote {
  orderId: string;
  number: string;
}

export const UNPAID_ORDER_QUERY_KEY = ['orders', 'unpaid'] as const;

/**
 * Asks each time the cart opens (signed in only), from the first page of her orders: an unpaid
 * order is always "in progress", and there is at most one (U11). A failed ask shows nothing.
 */
export function useUnpaidOrder(enabled: boolean) {
  return useQuery({
    queryKey: UNPAID_ORDER_QUERY_KEY,
    queryFn: async (): Promise<UnpaidOrderNote | null> => {
      const outcome = await callAction(() => listOrdersAction({}));
      if (!outcome.ok) return null;
      const waiting = outcome.data.inProgress.find(
        (order) => order.statusWord === 'waitingForPayment',
      );
      return waiting ? { orderId: waiting.id, number: waiting.number } : null;
    },
    staleTime: 0,
    retry: false,
    enabled,
  });
}
