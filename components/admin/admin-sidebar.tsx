'use client';

import { Bike, LogOut, Map as MapIcon, Settings, SquareKanban, Store, Wallet } from 'lucide-react';
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
  SidebarMenuSub,
  SidebarMenuSubItem,
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
 * "Order board", "Live map" (F8 A46.1) and "Partners" for SUPPORT, ADMIN and the demo admin
 * (F6 A18.1), with F9's "Earnings and payouts" under Partners for ADMIN and the demo admin.
 * The current page is marked by a bar, weight and tint, never a tint alone.
 */

const SCREENS = {
  orderBoard: { label: 'Order board', href: '/admin/orders' satisfies Route, icon: SquareKanban },
  liveMap: { label: 'Live map', href: '/admin/map' satisfies Route, icon: MapIcon },
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
    // The number is drawn by CSS, so it isn't part of the link's text: the link's name says it
    // in words ("Partners, 2 applications to review").
    <span
      aria-hidden
      data-count={badgeText(count)}
      className="ml-auto inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-neutral-1 px-1.5 text-caption font-semibold text-white tabular-nums after:content-[attr(data-count)] group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:top-1 group-data-[collapsible=icon]:right-1 group-data-[collapsible=icon]:ml-0 group-data-[collapsible=icon]:h-5 group-data-[collapsible=icon]:min-w-5 group-data-[collapsible=icon]:px-1"
    />
  );
}

/** F9 design 3.1: the payouts report, a sub-item of Partners (`earnings: report`). */
const REPORT = {
  label: 'Earnings and payouts',
  href: '/admin/partners/earnings' satisfies Route,
} as const;

const isReport = (pathname: string) =>
  pathname === REPORT.href || pathname.startsWith(`${REPORT.href}/`);

/** Partners is current on its list and a partner's page, never on the report (design 3.1). */
function isCurrent(href: string, pathname: string): boolean {
  if (href === SCREENS.partners.href && isReport(pathname)) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

const NAV_BUTTON =
  'relative h-11 gap-3 rounded-lg px-3 text-body-4 text-neutral-2 hover:bg-neutral-7 hover:text-neutral-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:ring-0 group-data-[collapsible=icon]:size-12! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0! [&_svg]:size-5!';

const CURRENT =
  'bg-neutral-7 font-semibold text-neutral-1 before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-brand-strong [&_svg]:text-brand-strong';

/** The sub-item: its words line up with the parent's label (design 3.1). */
const SUB_BUTTON =
  'relative flex h-10 min-w-0 items-center rounded-lg pr-3 pl-11 text-body-5 text-neutral-2 outline-none hover:bg-neutral-7 hover:text-neutral-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid';

export function AdminSidebar() {
  const shell = useStaffShell();
  const pathname = usePathname();
  const { state, isMobile, setOpenMobile } = useSidebar();
  const rail = state === 'collapsed' && !isMobile;
  const { signOut, request, onCloseAutoFocus } = useStaffSignOut();
  const accountRef = useRef<HTMLButtonElement>(null);
  const toReview = useReviewCount(shell.screens.includes('partners'));
  // ADMIN and the demo admin (both the admin role) read the report; SUPPORT never sees it.
  const report = shell.screens.includes('partners') && shell.user.role === 'admin';
  const onReport = isReport(pathname);

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
                const current = isCurrent(item.href, pathname);
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
                    {screen === 'partners' && report ? (
                      // Hidden on the rail (shadcn hides sub-items there): its own button follows.
                      <SidebarMenuSub className="mx-0 mt-1 translate-x-0 border-l-0 px-0 py-0">
                        <SidebarMenuSubItem>
                          <Link
                            href={REPORT.href}
                            aria-current={onReport ? 'page' : undefined}
                            onClick={closeDrawer}
                            className={cn(SUB_BUTTON, onReport && CURRENT)}
                          >
                            {REPORT.label}
                          </Link>
                        </SidebarMenuSubItem>
                      </SidebarMenuSub>
                    ) : null}
                  </SidebarMenuItem>
                );
              })}
              {report ? (
                // The rail (1024 to 1279 px) can't show sub-items, so the report gets its own icon.
                <SidebarMenuItem className="hidden group-data-[collapsible=icon]:block">
                  <SidebarMenuButton
                    asChild
                    tooltip={REPORT.label}
                    className={cn(NAV_BUTTON, onReport && CURRENT)}
                  >
                    <Link
                      href={REPORT.href}
                      aria-current={onReport ? 'page' : undefined}
                      onClick={closeDrawer}
                    >
                      <Wallet aria-hidden />
                      <span className="sr-only">{REPORT.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ) : null}
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
