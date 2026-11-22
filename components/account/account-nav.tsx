'use client';

import {
  CreditCard,
  Download,
  Heart,
  LogOut,
  type LucideIcon,
  MapPin,
  Receipt,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRef } from 'react';
import { Avatar } from '@/components/layout/account-entry';
import { SignOutDialog, useSignOut } from '@/components/layout/sign-out';
import { Button } from '@/components/ui/button';
import { initialOf } from '@/lib/account-text';
import { cn } from '@/lib/utils';
import { useAccount } from './account-context';

interface Section {
  href: Route;
  label: string;
  /** The side nav's longer label. */
  longLabel?: string;
  icon: LucideIcon;
}

const SECTIONS: readonly Section[] = [
  { href: '/account', label: 'Account', icon: UserRound },
  { href: '/account/orders', label: 'Orders', icon: Receipt },
  { href: '/account/favorites', label: 'Favorites', icon: Heart },
  { href: '/account/addresses', label: 'Addresses', icon: MapPin },
  { href: '/account/cards', label: 'Saved cards', icon: CreditCard },
  { href: '/account/security', label: 'Security', icon: ShieldCheck },
  { href: '/account/privacy', label: 'Privacy', longLabel: 'Privacy and data', icon: Download },
];

const isCurrent = (href: string, pathname: string) =>
  href === '/account' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

/** Pages with their own "Back to…" link instead of the phone nav bar. */
const isSubPage = (pathname: string) =>
  /^\/account\/(addresses\/[^/]+|privacy\/delete)\/?$/.test(pathname);

/**
 * Where each section sits in the phone bar (F4 design 1.2): 3 + 3 + 1 under 360 px, 4 + 3 to
 * 767, one row of seven from md.
 */
const BAR_SPANS = [
  'min-[360px]:col-span-3',
  'min-[360px]:col-span-3',
  'min-[360px]:col-span-3',
  'min-[360px]:col-span-3',
  'min-[360px]:col-span-4',
  'min-[360px]:col-span-4',
  'col-span-3 min-[360px]:col-span-4',
] as const;

/**
 * The account sections below `lg`: seven segments with the icon above the label (F4 design
 * 1.2, D42). Hidden on sub-pages, which show their back link instead (F2 design 4.1).
 */
export function AccountNavBar() {
  const pathname = usePathname();
  if (isSubPage(pathname)) return null;

  return (
    <nav aria-label="Account" className="mb-8 md:mb-10 lg:hidden">
      <ul className="mx-auto grid grid-cols-3 gap-1 rounded-lg bg-white p-1.5 shadow-card min-[360px]:grid-cols-12 md:max-w-[672px] md:grid-cols-7">
        {SECTIONS.map((section, index) => {
          const current = isCurrent(section.href, pathname);
          const Icon = section.icon;
          return (
            <li key={section.href} className={cn(BAR_SPANS[index], 'md:col-span-1')}>
              <Link
                href={section.href}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'flex h-14 flex-col items-center justify-center gap-1 rounded-lg px-1 text-center text-caption font-medium text-neutral-3 hover:bg-neutral-7 hover:text-neutral-1 focus-visible:-outline-offset-2',
                  current && 'bg-brand-strong text-white hover:bg-brand-strong hover:text-white',
                )}
              >
                <Icon className="size-5" aria-hidden />
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The account sections from `lg`: who is signed in, the seven sections, and Sign out. */
export function AccountSideNav() {
  const pathname = usePathname();
  const account = useAccount();
  const signOut = useSignOut();
  const buttonRef = useRef<HTMLButtonElement>(null);

  return (
    <nav
      aria-label="Account"
      className="hidden self-start lg:sticky lg:top-6 lg:col-span-3 lg:block"
    >
      <div className="mb-2 flex items-center gap-3 border-b border-neutral-6 pb-6">
        <Avatar
          initial={initialOf(account.name)}
          className="size-12 font-heading text-title-2 font-normal"
        />
        <div className="min-w-0">
          <p className="truncate text-body-3 font-medium text-neutral-1">{account.name}</p>
          <p className="truncate text-body-5 text-muted-foreground">{account.email}</p>
        </div>
      </div>
      <ul className="space-y-1">
        {SECTIONS.map((section) => {
          const current = isCurrent(section.href, pathname);
          const Icon = section.icon;
          return (
            <li key={section.href}>
              <Link
                href={section.href}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'relative flex h-12 items-center gap-3 rounded-lg px-4 text-body-4 font-medium text-neutral-3 hover:bg-neutral-7 hover:text-neutral-1 focus-visible:-outline-offset-2',
                  current &&
                    'bg-brand-soft font-semibold text-neutral-1 before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-full before:bg-brand-strong hover:bg-brand-soft',
                )}
              >
                <Icon className={cn('size-5', current && 'text-brand-strong')} aria-hidden />
                {section.longLabel ?? section.label}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 border-t border-neutral-6 pt-4">
        <Button
          ref={buttonRef}
          type="button"
          variant="ghost"
          onClick={() => signOut.request()}
          aria-disabled={signOut.pending || undefined}
          className="flex h-12 w-full justify-start gap-3 rounded-lg px-4 text-body-4 font-medium text-neutral-3 hover:bg-neutral-7 hover:text-neutral-1 focus-visible:-outline-offset-2"
        >
          <LogOut className="size-5" aria-hidden />
          Sign out
        </Button>
      </div>
      <SignOutDialog state={signOut} onCloseFocus={() => buttonRef.current?.focus()} />
    </nav>
  );
}

/** "Sign out" at the bottom of /account on phones and tablets (the side nav has it on desktop). */
export function AccountSignOutButton() {
  const signOut = useSignOut();
  const buttonRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="mt-10 lg:hidden">
      <Button
        ref={buttonRef}
        type="button"
        variant="outline"
        size="touch"
        onClick={() => signOut.request()}
        aria-disabled={signOut.pending || undefined}
        className="w-full border-neutral-6 bg-white text-neutral-2 hover:bg-neutral-7"
      >
        <LogOut className="size-4" aria-hidden />
        Sign out
      </Button>
      <SignOutDialog state={signOut} onCloseFocus={() => buttonRef.current?.focus()} />
    </div>
  );
}
