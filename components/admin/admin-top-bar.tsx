'use client';

import { Menu, PanelLeft } from 'lucide-react';
import Image from 'next/image';
import type { ReactNode } from 'react';
import { LogoLink } from '@/components/layout/logo';
import { Button } from '@/components/ui/button';
import { useSidebar } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { StaffAccountMenu } from './staff-account-menu';
import { useStaffShell } from './staff-shell-context';

/*
 * The top bar of every staff page (F5 design 1.3). DOM order is the visual order: start, the
 * page's h1, the status chips, then the controls at the end. KITCHEN's logo is not a link, so
 * a stray tap never takes the tablet off the board (D4).
 */

function SidebarToggle() {
  const { isMobile, state, toggleSidebar } = useSidebar();
  const label = isMobile
    ? 'Open menu'
    : state === 'expanded'
      ? 'Collapse sidebar'
      : 'Expand sidebar';
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-kitchen"
      aria-label={label}
      onClick={toggleSidebar}
      className="-ml-2 text-neutral-2"
    >
      {isMobile ? (
        <Menu className="size-5" aria-hidden />
      ) : (
        <PanelLeft className="size-5" aria-hidden />
      )}
    </Button>
  );
}

export function AdminTopBar({
  title,
  status,
  end,
  className,
}: {
  /** The page's h1 ("Order board", "Order 1042"); omitted where the content holds the h1. */
  title?: string;
  /** Store and live chips (hidden below `md`, where the toolbar carries the store chip). */
  status?: ReactNode;
  /** Controls before the account menu: sound, "Keep screen on". */
  end?: ReactNode;
  className?: string;
}) {
  const shell = useStaffShell();

  return (
    <header
      className={cn(
        'sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-neutral-6 bg-white px-4 md:gap-3 lg:px-6',
        className,
      )}
    >
      {shell.frame === 'sidebar' ? <SidebarToggle /> : null}
      {shell.frame === 'kitchen' ? (
        <Image
          src="/Logo/logo.svg"
          alt="Foodz"
          width={98}
          height={28}
          unoptimized
          className="h-7 w-auto shrink-0"
        />
      ) : null}
      {shell.frame === 'gate' || shell.frame === 'editor' ? (
        <LogoLink imageClassName="h-7" />
      ) : null}
      {title ? (
        <h1 className="min-w-0 truncate font-heading text-body-2 text-neutral-2 tabular-nums md:text-title-2">
          {title}
        </h1>
      ) : null}
      {status ? <div className="flex min-w-0 items-center gap-2">{status}</div> : null}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {end}
        {shell.frame === 'sidebar' ? null : (
          <StaffAccountMenu user={shell.user} kitchen={shell.frame === 'kitchen'} />
        )}
      </div>
    </header>
  );
}
