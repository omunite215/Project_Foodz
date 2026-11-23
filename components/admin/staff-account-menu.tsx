'use client';

import { ChevronDown, LogOut, Settings, Store } from 'lucide-react';
import Link from 'next/link';
import { useRef } from 'react';
import { Avatar } from '@/components/layout/account-entry';
import { SignOutDialog, useSignOut } from '@/components/layout/sign-out';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { initialOf } from '@/lib/account-text';
import { cn } from '@/lib/utils';
import { roleLabel, type StaffShellValue } from './staff-shell-context';

/** The items under the person: Account settings, View site, Sign out (design 1.2, 1.3). */
export function StaffMenuItems({
  kitchen,
  onSignOut,
}: {
  /** KITCHEN gets "Sign out" only (A16.1). */
  kitchen: boolean;
  onSignOut: () => void;
}) {
  return (
    <>
      {kitchen ? null : (
        <>
          <DropdownMenuItem asChild className="h-12">
            <Link href="/account/security">
              <Settings className="text-neutral-3" aria-hidden />
              Account settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="h-12">
            <Link href="/">
              <Store className="text-neutral-3" aria-hidden />
              View site
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
        </>
      )}
      <DropdownMenuItem className="h-12" onSelect={onSignOut}>
        <LogOut className="text-neutral-3" aria-hidden />
        Sign out
      </DropdownMenuItem>
    </>
  );
}

/** The name and role at the top of a staff menu: "Foodz Admin · Admin". */
export function StaffMenuLabel({ user }: { user: StaffShellValue['user'] }) {
  return (
    <DropdownMenuLabel>
      <span className="block text-body-4 font-medium text-neutral-1 [overflow-wrap:anywhere]">
        {user.name}
      </span>
      <span className="block text-body-5 text-muted-foreground">{roleLabel(user)}</span>
    </DropdownMenuLabel>
  );
}

/**
 * Signing out from a staff menu starts once the menu has closed, so a quick answer never races
 * the menu handing focus back to its trigger (as the storefront's account menu does).
 */
export function useStaffSignOut() {
  const signOut = useSignOut();
  const pending = useRef(false);
  return {
    signOut,
    request: () => {
      pending.current = true;
    },
    onCloseAutoFocus: () => {
      if (!pending.current) return;
      pending.current = false;
      signOut.request();
    },
  };
}

/** The top bar's account menu (KITCHEN, CONTENT_EDITOR and the gates; design 1.3). */
export function StaffAccountMenu({
  user,
  kitchen,
  className,
}: {
  user: StaffShellValue['user'];
  kitchen: boolean;
  className?: string;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { signOut, request, onCloseAutoFocus } = useStaffSignOut();

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          ref={triggerRef}
          className={cn(
            'inline-flex size-12 shrink-0 items-center justify-center gap-1 rounded-full outline-none hover:bg-neutral-7 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid data-[state=open]:bg-neutral-7 lg:w-auto lg:px-1.5',
            className,
          )}
        >
          <span className="sr-only">Account menu for {user.name}</span>
          <Avatar initial={initialOf(user.name)} />
          <ChevronDown className="hidden size-4 text-neutral-3 lg:block" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={8}
          className="w-72 max-w-[calc(100vw-2rem)]"
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <StaffMenuLabel user={user} />
          <DropdownMenuSeparator />
          <StaffMenuItems kitchen={kitchen} onSignOut={request} />
        </DropdownMenuContent>
      </DropdownMenu>
      <SignOutDialog state={signOut} onCloseFocus={() => triggerRef.current?.focus()} />
    </>
  );
}
