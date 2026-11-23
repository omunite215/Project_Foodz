'use client';

import { Bike, LogOut, Settings, SquareKanban, Store } from 'lucide-react';
import type { Route } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { Avatar } from '@/components/layout/account-entry';
import { SignOutDialog } from '@/components/layout/sign-out';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { usePartnerBadge } from '@/components/partner-review/queries';
import { initialOf } from '@/lib/account-text';
import { badgeSrText, badgeText, badgeTooltip } from '@/lib/partner-review/text';
import { cn } from '@/lib/utils';
import { StaffMenuItems, StaffMenuLabel, useStaffSignOut } from './staff-account-menu';
import { roleLabel, useStaffShell } from './staff-shell-context';

/*
 * The staff sidebar (F5 design 1.2): SUPPORT, ADMIN and the demo admin. 256 px expanded, a
 * 72 px icon rail, a 288 px drawer on phones. It lists only screens that exist for this role:
 * "Order board", and "Partners" for SUPPORT, ADMIN and the demo admin (F6 A18.1). The current
 * page is marked by a bar, weight and tint, never a tint alone.
 */

const SCREENS = {
  orderBoard: { label: 'Order board', href: '/admin/orders' satisfies Route, icon: SquareKanban },
  partners: { label: 'Partners', href: '/admin/partners' satisfies Route, icon: Bike },
} as const;

/**
 * Applications to review (F6 7.1): neutral, not amber, since a count of work isn't lateness.
 * Recounted on every page and every 60 s; the number swaps without motion and isn't announced.
 * The link's name carries it ("Partners, 2 applications to review"); the badge is hidden.
 */
function useReviewCount(enabled: boolean) {
  const pathname = usePathname();
  const badge = usePartnerBadge(enabled);
  const { refetch } = badge;
  // Recounted on every page load (A18.1): each navigation asks again.
  const countedAt = useRef(pathname);
  useEffect(() => {
    if (!enabled || countedAt.current === pathname) return;
    countedAt.current = pathname;
    void refetch();
  }, [enabled, pathname, refetch]);
  return badge.data?.toReview ?? 0;
}

function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden
      className="ml-auto inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-neutral-1 px-1.5 text-caption font-semibold text-white tabular-nums group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:top-1 group-data-[collapsible=icon]:right-1 group-data-[collapsible=icon]:ml-0 group-data-[collapsible=icon]:h-5 group-data-[collapsible=icon]:min-w-5 group-data-[collapsible=icon]:px-1"
    >
      {badgeText(count)}
    </span>
  );
}

const NAV_BUTTON =
  'relative h-11 gap-3 rounded-lg px-3 text-body-4 text-neutral-2 hover:bg-neutral-7 hover:text-neutral-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:ring-0 group-data-[collapsible=icon]:size-12! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0! [&_svg]:size-5!';

const CURRENT =
  'bg-neutral-7 font-semibold text-neutral-1 before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-brand-strong [&_svg]:text-brand-strong';

export function AdminSidebar() {
  const shell = useStaffShell();
  const pathname = usePathname();
  const { state, isMobile, setOpenMobile } = useSidebar();
  const rail = state === 'collapsed' && !isMobile;
  const { signOut, request, onCloseAutoFocus } = useStaffSignOut();
  const accountRef = useRef<HTMLButtonElement>(null);
  const toReview = useReviewCount(shell.screens.includes('partners'));

  // The drawer closes on navigation (design 1.2).
  const closeDrawer = () => setOpenMobile(false);

  return (
    <Sidebar collapsible="icon" className="border-sidebar-border bg-sidebar">
      <SidebarHeader className="h-14 flex-row items-center border-b border-neutral-6 px-3 py-0">
        <Link
          href="/admin"
          aria-label="Foodz staff tools"
          className="inline-flex min-h-11 min-w-0 items-center gap-3 rounded-lg group-data-[collapsible=icon]:mx-auto"
        >
          {rail ? (
            <span
              aria-hidden
              className="flex size-10 items-center justify-center rounded-xl bg-brand-soft font-heading text-title-2 text-brand-strong"
            >
              F
            </span>
          ) : (
            <>
              <Image
                src="/Logo/logo.svg"
                alt=""
                width={112}
                height={32}
                unoptimized
                className="h-8 w-auto"
              />
              <span aria-hidden className="text-caption whitespace-nowrap text-neutral-3">
                Staff tools
              </span>
            </>
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <nav aria-label="Staff">
          <SidebarGroup>
            <SidebarMenu className="gap-1">
              {shell.screens.map((screen) => {
                const item = SCREENS[screen];
                const Icon = item.icon;
                const current = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const count = screen === 'partners' ? toReview : 0;
                return (
                  <SidebarMenuItem key={screen}>
                    <SidebarMenuButton
                      asChild
                      tooltip={screen === 'partners' ? badgeTooltip(count) : item.label}
                      className={cn(NAV_BUTTON, current && CURRENT)}
                    >
                      <Link
                        href={item.href}
                        aria-current={current ? 'page' : undefined}
                        // One name, "Partners, 2 applications to review": a hidden part in its own
                        // element would be read with a pause before the comma.
                        aria-label={count > 0 ? `${item.label}${badgeSrText(count)}` : undefined}
                        onClick={closeDrawer}
                      >
                        <Icon aria-hidden />
                        <span className="group-data-[collapsible=icon]:sr-only">{item.label}</span>
                        <CountBadge count={count} />
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        </nav>
      </SidebarContent>

      <SidebarFooter className="border-t border-neutral-6 p-2">
        {rail ? (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger
              ref={accountRef}
              className="mx-auto flex size-12 items-center justify-center rounded-full outline-none hover:bg-neutral-7 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid data-[state=open]:bg-neutral-7"
            >
              <span className="sr-only">Account menu for {shell.user.name}</span>
              <Avatar initial={initialOf(shell.user.name)} />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="right"
              align="end"
              sideOffset={8}
              className="w-72"
              onCloseAutoFocus={onCloseAutoFocus}
            >
              <StaffMenuLabel user={shell.user} />
              <DropdownMenuSeparator />
              <StaffMenuItems kitchen={false} onSignOut={request} />
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <>
            <div className="flex items-center gap-3 px-2 py-2">
              <Avatar initial={initialOf(shell.user.name)} />
              <p className="min-w-0">
                <span className="block truncate text-body-5 font-semibold text-neutral-1">
                  {shell.user.name}
                  <span className="sr-only"> · </span>
                </span>
                <span className="block text-caption text-neutral-3">{roleLabel(shell.user)}</span>
              </p>
            </div>
            <SidebarMenu className="gap-1">
              <SidebarMenuItem>
                <SidebarMenuButton asChild className={NAV_BUTTON}>
                  <Link href="/account/security" onClick={closeDrawer}>
                    <Settings className="text-neutral-3" aria-hidden />
                    <span>Account settings</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild className={NAV_BUTTON}>
                  <Link href="/" onClick={closeDrawer}>
                    <Store className="text-neutral-3" aria-hidden />
                    <span>View site</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton className={NAV_BUTTON} onClick={() => signOut.request()}>
                  <LogOut className="text-neutral-3" aria-hidden />
                  <span>Sign out</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </>
        )}
      </SidebarFooter>
      <SignOutDialog state={signOut} onCloseFocus={() => accountRef.current?.focus()} />
    </Sidebar>
  );
}
