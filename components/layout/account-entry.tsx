'use client';

import {
  ChevronDown,
  CircleUserRound,
  Heart,
  LogOut,
  MapPin,
  Receipt,
  UserRound,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useRef } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { authPageHref, returnPathFor } from '@/lib/auth-links';
import { cn } from '@/lib/utils';
import { SignOutDialog, useSignOut } from './sign-out';

/** What the header knows about the signed-in person, read on the server (S2.1). */
export interface HeaderAccount {
  firstName: string;
  initial: string;
  fullName: string;
  email: string;
  isDemo: boolean;
}

/** The "Sign in" link, returning to this page afterwards. */
export function useAuthHref(page: '/sign-in' | '/sign-up'): Route {
  const pathname = usePathname();
  const search = useSearchParams();
  return authPageHref(page, returnPathFor(pathname, search));
}

function SignInEntry() {
  const pathname = usePathname();
  const href = useAuthHref('/sign-in');
  const current = pathname === '/sign-in';

  return (
    <Link
      href={href}
      data-sign-in-entry=""
      aria-current={current ? 'page' : undefined}
      className={cn(
        'inline-flex size-11 shrink-0 items-center justify-center gap-2 rounded-lg text-neutral-2 hover:bg-neutral-7 lg:w-auto lg:px-2 lg:text-button-1 lg:font-medium lg:hover:bg-transparent lg:hover:text-brand-strong',
        current && 'text-brand-strong',
      )}
    >
      <CircleUserRound className="size-6 lg:text-neutral-3" aria-hidden />
      <span className="sr-only lg:not-sr-only">Sign in</span>
    </Link>
  );
}

const MENU_LINKS: { href: Route; label: string; icon: typeof UserRound }[] = [
  { href: '/account', label: 'Account', icon: UserRound },
  { href: '/account/orders', label: 'Orders', icon: Receipt },
  { href: '/account/favorites', label: 'Favorites', icon: Heart },
  { href: '/account/addresses', label: 'Addresses', icon: MapPin },
];

/** The avatar letter on a soft green disc. */
export function Avatar({ initial, className }: { initial: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-body-4 font-semibold text-neutral-1',
        className,
      )}
    >
      {initial}
    </span>
  );
}

function AccountMenu({ account }: { account: HeaderAccount }) {
  const pathname = usePathname();
  const signOut = useSignOut();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const signOutOnClose = useRef(false);

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          ref={triggerRef}
          className="inline-flex size-11 shrink-0 items-center justify-center gap-2 rounded-full p-1 outline-none hover:bg-neutral-7 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid data-[state=open]:bg-neutral-7 lg:w-auto lg:pr-2 xl:pr-3"
        >
          {/* Named "Account menu for Maya" from its own text, which includes the visible name. */}
          <span className="sr-only">Account menu for </span>
          <Avatar initial={account.initial} />
          <span className="sr-only max-w-[10ch] truncate text-button-1 font-medium text-neutral-2 xl:not-sr-only">
            {account.firstName}
          </span>
          <ChevronDown className="hidden size-4 text-neutral-3 lg:block" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={8}
          className="w-72 max-w-[calc(100vw-2rem)]"
          onCloseAutoFocus={() => {
            // The menu hands focus back to its button only once its closing fade has ended. Signing
            // out starts here, after that, so a quick answer can never be followed by the menu
            // pulling focus back to a button that is about to disappear.
            if (!signOutOnClose.current) return;
            signOutOnClose.current = false;
            signOut.request();
          }}
        >
          <DropdownMenuLabel>
            <span className="block text-body-4 font-medium text-neutral-1 [overflow-wrap:anywhere]">
              {account.fullName}
            </span>
            <span className="block text-body-5 text-muted-foreground [overflow-wrap:anywhere]">
              {account.email}
            </span>
            {account.isDemo ? (
              <span className="mt-1.5 inline-flex h-6 items-center rounded-md bg-tag-6-bg px-2 text-caption font-medium text-neutral-1">
                Shared demo account
              </span>
            ) : null}
          </DropdownMenuLabel>
          {MENU_LINKS.map((link) => {
            const Icon = link.icon;
            const current = pathname === link.href;
            return (
              <DropdownMenuItem key={link.href} asChild>
                <Link
                  href={link.href}
                  aria-current={current ? 'page' : undefined}
                  className={cn(current && 'font-semibold')}
                >
                  <Icon className="text-neutral-3" aria-hidden />
                  {link.label}
                </Link>
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              signOutOnClose.current = true;
            }}
          >
            <LogOut className="text-neutral-3" aria-hidden />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <SignOutDialog state={signOut} onCloseFocus={() => triggerRef.current?.focus()} />
    </>
  );
}

/**
 * The header's account slot (design 1.1). Its state comes from the server render, so the first
 * paint is already right and a throttled session check can never turn it into "Sign in". On
 * phones both states are the same 44 px slot.
 */
export function AccountEntry({ account }: { account: HeaderAccount | null }) {
  return account ? <AccountMenu account={account} /> : <SignInEntry />;
}
