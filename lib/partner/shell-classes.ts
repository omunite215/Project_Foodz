import { cn } from '@/lib/utils';

/*
 * The partner headers' class lists (F6 design 2.2), kept here so their merge is tested: both
 * stick to the top of every app screen, and F9's day headers stick right under them
 * (`--partner-sticky-top`). A later position class (`relative`) would win the merge and unstick
 * them.
 */

const HEADER_BASE = 'sticky top-0 z-30 pt-[env(safe-area-inset-top)] box-content';

/** Apply, gates, decisions, terms and the suspended earnings: the plain header. */
export const plainHeaderClass = cn(
  HEADER_BASE,
  'flex h-14 items-center gap-1 border-b border-border bg-background px-1',
);

/** Home, Earnings, Profile and Your ratings: the status header, filled by the state. */
export const statusHeaderClass = (online: boolean) =>
  cn(
    HEADER_BASE,
    // `sticky` is already a containing block and `isolate` a stacking context.
    'isolate flex h-14 items-center gap-3 px-4',
    online
      ? 'bg-status-online text-status-online-foreground'
      : 'bg-status-offline text-status-offline-foreground',
  );
