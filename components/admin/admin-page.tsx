'use client';

import { Clock, Eye } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { SESSION_WARNING_MS } from '@/server/modules/staff/schema';
import { Button } from '@/components/ui/button';
import { DEMO_BANNER, sessionEndingText } from '@/lib/board/text';
import { cn } from '@/lib/utils';
import { AdminTopBar } from './admin-top-bar';
import { Banner, BannerStack } from './banners';
import { BoardNotices } from './board-notices';
import { useSignInAgainHref } from './signed-out-overlay';
import { useStaffShell } from './staff-shell-context';

export type SessionPhase = 'ok' | 'ending' | 'ended';

/** Where the 12-hour staff session stands (A1.7): the banner from 15 minutes before the end. */
export function sessionPhase(expiresAt: string | null, now: number): SessionPhase {
  if (!expiresAt) return 'ok';
  const left = Date.parse(expiresAt) - now;
  if (left <= 0) return 'ended';
  return left <= SESSION_WARNING_MS ? 'ending' : 'ok';
}

/** The session phase, kept current with one timer to the next change. */
export function useSessionPhase(expiresAt: string | null): SessionPhase {
  // Null in the server's HTML and while hydrating: the banner only appears in the browser.
  const [now, setNow] = useState<number | null>(null);
  const phase = now === null ? 'ok' : sessionPhase(expiresAt, now);

  useEffect(() => {
    if (!expiresAt) return undefined;
    const end = Date.parse(expiresAt);
    // Read the clock now, when the warning starts and when the session ends (12 hours at most).
    const moments = [0, end - SESSION_WARNING_MS - Date.now(), end - Date.now()].filter(
      (wait) => wait >= 0,
    );
    const timers = moments.map((wait) => setTimeout(() => setNow(Date.now()), wait + 50));
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [expiresAt]);

  return phase;
}

function SessionEndingBanner({ expiresAt, timeZone }: { expiresAt: string; timeZone: string }) {
  const href = useSignInAgainHref();
  return (
    <Banner
      variant="info"
      icon={Clock}
      action={
        <Button asChild variant="outline" size="kitchen" className="bg-white text-button-2">
          <a href={href}>Sign in again</a>
        </Button>
      }
    >
      {sessionEndingText(expiresAt, timeZone)}
    </Banner>
  );
}

/**
 * One staff page (F5 design 1.3, 1.5): the top bar, then `<main>` holding the banner stack
 * (demo first, then session ending, then the page's own banners) and the content.
 */
export function AdminPage({
  title,
  status,
  end,
  banners,
  children,
  className,
  mainClassName,
}: {
  title?: string;
  status?: ReactNode;
  end?: ReactNode;
  /** The page's own banners, after demo and session ending. */
  banners?: ReactNode;
  children: ReactNode;
  className?: string;
  mainClassName?: string;
}) {
  const shell = useStaffShell();
  const session = useSessionPhase(shell.sessionExpiresAt);

  return (
    <div className={cn('flex min-h-dvh min-w-0 flex-col', className)}>
      <AdminTopBar title={title} status={status} end={end} />
      <main
        id="main"
        tabIndex={-1}
        className={cn('relative flex min-w-0 flex-1 flex-col focus:outline-none', mainClassName)}
      >
        <BannerStack>
          {shell.readOnly ? (
            <Banner variant="warning" icon={Eye} announceOnShow={false} animateIn={false}>
              {DEMO_BANNER}
            </Banner>
          ) : null}
          {session === 'ending' && shell.sessionExpiresAt ? (
            <SessionEndingBanner expiresAt={shell.sessionExpiresAt} timeZone={shell.timeZone} />
          ) : null}
          {banners}
        </BannerStack>
        {children}
      </main>
      <BoardNotices />
    </div>
  );
}
