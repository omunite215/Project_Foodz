'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { onAuthEvent } from '@/lib/auth-channel';
import { useCartSession } from '@/lib/data/cart';
import { SessionToast, showSessionToast, SIGNED_OUT_ELSEWHERE_TEXT } from './session-toast';

/**
 * Keeps this tab in step with the session (S5.8, S5.10, S3.2):
 * - a cart kept for a session that has since ended is emptied, and the person is told;
 * - when another tab signs in, signs out or confirms the email, this one re-reads the page;
 * - while the email is waiting for confirmation, returning to the tab re-reads it too.
 */
export function SessionWatch({
  sessionKey,
  refreshOnReturn,
}: {
  /** An opaque key for the signed-in session (never its token); null when signed out. */
  sessionKey: string | null;
  refreshOnReturn: boolean;
}) {
  const router = useRouter();

  useCartSession(sessionKey, () => showSessionToast(SIGNED_OUT_ELSEWHERE_TEXT));

  useEffect(() => onAuthEvent(() => router.refresh()), [router]);

  useEffect(() => {
    if (!refreshOnReturn) return undefined;
    const onVisible = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refreshOnReturn, router]);

  return <SessionToast />;
}
