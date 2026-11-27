'use client';

import { useSelector } from '@tanstack/react-store';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { acceptedSince, dispatchStore } from '@/lib/partner/dispatch';

/**
 * QA U1: accepting an offer over Earnings or Your ratings goes straight to Home, where the
 * pick-up map is, instead of leaving him one tap away from it.
 */
export function useOpenDeliveryOnAccept() {
  const router = useRouter();
  const lastClose = useSelector(dispatchStore, (state) => state.lastClose);
  const seen = useRef(lastClose?.id ?? 0);
  useEffect(() => {
    if (!acceptedSince(seen.current, lastClose)) return;
    seen.current = lastClose.id;
    router.push('/partner');
  }, [lastClose, router]);
}
