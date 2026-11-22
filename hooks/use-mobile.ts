import { useSyncExternalStore } from 'react';

/** Below `md` (768 px), where the staff sidebar becomes a drawer (F5 design 1.2). */
const MOBILE_QUERY = '(max-width: 767.98px)';

function subscribe(onChange: () => void) {
  const query = window.matchMedia(MOBILE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/** True below 768 px; false in the server's HTML. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  );
}
