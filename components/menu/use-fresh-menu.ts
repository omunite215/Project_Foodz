'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** An open menu asks the server again this often while it is in view (F5 U24, "86 it"). */
export const MENU_REFRESH_MS = 30_000;

/**
 * The kitchen's sold-out and back-on-the-menu changes reach a menu that is already open "within
 * a minute", as the sold-out sheet promises: the listing is read again every 30 seconds while the
 * tab is visible and online, and as soon as the person comes back to the tab. Nothing moves or
 * is announced; a dish simply shows "Sold out today", or its button again.
 */
export function useFreshMenu() {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) router.refresh();
    };
    const timer = setInterval(refresh, MENU_REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [router]);
}
