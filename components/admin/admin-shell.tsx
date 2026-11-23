'use client';

import { usePathname } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useMediaQuery } from '@/lib/use-media-query';
import { AdminSidebar } from './admin-sidebar';
import { StaffShellProvider, type StaffShellValue } from './staff-shell-context';

/*
 * The `/admin` frame (F5 design 1.1, 1.2): the skip link first, then the sidebar for the roles
 * that have one, then the page (its top bar, banners and content). Its look is decided by the
 * server's StaffShell; nothing here grants or hides access.
 */

/** The sidebar expands by itself from 1440 px until the person chooses (design 1.2). */
const EXPANDED_QUERY = '(min-width: 90rem)';

function SkipLink() {
  const pathname = usePathname();
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:inline-flex focus:h-12 focus:items-center focus:rounded-lg focus:bg-neutral-1 focus:px-4 focus:text-button-1 focus:font-medium focus:text-neutral-8"
    >
      {pathname === '/admin/orders' ? 'Skip to the board' : 'Skip to main content'}
    </a>
  );
}

/**
 * Open or rail. A saved choice (shadcn's `sidebar_state` cookie, read on the server) wins;
 * without one, the rail shows below 1440 px and the full sidebar from there, so a 1280 laptop
 * gives the board the extra width. The layout changes once, never animates (D18).
 */
function useSidebarOpen(saved: boolean | null) {
  const wide = useMediaQuery(EXPANDED_QUERY);
  const [choice, setChoice] = useState<boolean | null>(saved);
  return [choice ?? wide, setChoice] as const;
}

function WithSidebar({ saved, children }: { saved: boolean | null; children: ReactNode }) {
  const [open, setOpen] = useSidebarOpen(saved);
  return (
    <TooltipProvider delayDuration={300}>
      <SidebarProvider
        open={open}
        onOpenChange={setOpen}
        className="min-h-dvh bg-neutral-8"
        style={{ '--sidebar-width-mobile': '18rem' }}
      >
        <AdminSidebar />
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </SidebarProvider>
    </TooltipProvider>
  );
}

export function AdminShell({
  shell,
  sidebarOpen,
  children,
}: {
  shell: StaffShellValue;
  /** The saved sidebar choice; null when the person hasn't chosen yet. */
  sidebarOpen: boolean | null;
  children: ReactNode;
}) {
  return (
    <StaffShellProvider value={shell}>
      <SkipLink />
      {shell.frame === 'sidebar' ? (
        <WithSidebar saved={sidebarOpen}>{children}</WithSidebar>
      ) : (
        <div className="flex min-h-dvh min-w-0 flex-col bg-neutral-8">{children}</div>
      )}
    </StaffShellProvider>
  );
}
