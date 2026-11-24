'use client';

import { Lock, ShieldAlert } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { SignOutDialog, useSignOut } from '@/components/layout/sign-out';
import { EmptyState } from '@/components/states/empty-state';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { GATE_TITLES, type GateKind } from './gate-text';

export type { GateKind };

const BOARD_HREF: Route = '/admin/orders';

/*
 * The staff gate pages (F5 design 1.8): two-factor needed, no access (403), nothing here yet
 * (content editors) and order not found. One centred block, an h1 each. The two-factor gate
 * sends no order data and opens no realtime connection (A1.4).
 */

function Disc({ tone, children }: { tone: 'amber' | 'grey'; children: ReactNode }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-16 items-center justify-center rounded-full',
        tone === 'amber' ? 'bg-tag-6-bg text-neutral-1' : 'bg-neutral-7 text-neutral-3',
      )}
    >
      {children}
    </span>
  );
}

function SignOutButton() {
  const signOut = useSignOut();
  return (
    <>
      <Button type="button" size="touch" onClick={() => signOut.request()}>
        Sign out
      </Button>
      <SignOutDialog state={signOut} />
    </>
  );
}

function BackButton() {
  const router = useRouter();
  return (
    <Button
      type="button"
      variant="outline"
      size="touch"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push('/admin');
      }}
    >
      Back
    </Button>
  );
}

const SITE = (
  <Button asChild variant="outline" size="touch">
    <Link href="/">Go to the site</Link>
  </Button>
);

export function StaffGate({
  kind,
  titleAs = 'h1',
}: {
  kind: GateKind;
  /** The detail panel shows "Order not found" under its own heading. */
  titleAs?: 'h1' | 'h2';
}) {
  const content = {
    twoFactor: {
      media: (
        <Disc tone="amber">
          <ShieldAlert className="size-8" />
        </Disc>
      ),
      description:
        "Staff tools ask for a code from an authenticator app every time you sign in. Your account doesn't have two-factor sign-in yet, so ask an admin to set it up for you.",
      action: (
        <div className="flex flex-wrap justify-center gap-3">
          <SignOutButton />
          {SITE}
        </div>
      ),
    },
    noAccess: {
      media: (
        <Disc tone="grey">
          <Lock className="size-8" />
        </Disc>
      ),
      description: "You don't have access to the order board. Ask an admin if you need it.",
      action: <BackButton />,
    },
    nothingHere: {
      illustration: 'noData' as const,
      description:
        'Your tools for the menu, campaigns, the blog and site pages arrive in a later update.',
      action: SITE,
    },
    notFound: {
      illustration: 'pageEaten' as const,
      description: 'Check the number, or find the order from the board.',
      action: (
        <Button asChild size="touch">
          <Link href={BOARD_HREF}>Back to the board</Link>
        </Button>
      ),
    },
  }[kind];

  return (
    <div className="mx-auto w-full max-w-md px-4 py-16 text-center md:py-24">
      <EmptyState
        size="page"
        titleAs={titleAs}
        title={GATE_TITLES[kind]}
        description={content.description}
        action={content.action}
        {...('media' in content ? { media: content.media } : {})}
        {...('illustration' in content ? { illustration: content.illustration } : {})}
      />
    </div>
  );
}
