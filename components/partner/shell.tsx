'use client';

import {
  ChevronLeft,
  CircleUserRound,
  ExternalLink,
  House,
  type LucideIcon,
  Navigation,
  NavigationOff,
  Wallet,
  X,
} from 'lucide-react';
import type { Route } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { type ReactNode, useId, useLayoutEffect, useRef } from 'react';
import { SignOutDialog, useSignOut } from '@/components/layout/sign-out';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import { useSlowPending } from '@/components/forms/submit-button';
import { announce } from '@/lib/announce';
import { plainHeaderClass, statusHeaderClass } from '@/lib/partner/shell-classes';
import { cn } from '@/lib/utils';

/*
 * The partner shell (F6 design 2): one 448 px column at every width, a 56 px header, the page,
 * and a sticky bottom block with the dock (the one main action) and, for approved partners,
 * the tab bar. The status header is for glancing; everything a partner taps while riding sits
 * in the bottom third.
 */

export function PartnerFrame({
  header,
  pinned,
  dock,
  tabBar,
  children,
  mainClassName,
}: {
  header: ReactNode;
  /** The connection banner, pinned under the header (design 2.3). */
  pinned?: ReactNode;
  dock?: ReactNode;
  tabBar?: ReactNode;
  children: ReactNode;
  mainClassName?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  usePartnerStickyTop(rootRef);
  return (
    <div
      ref={rootRef}
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-background md:border-x md:border-border"
    >
      {header}
      {pinned ? (
        <div
          data-partner-pinned=""
          className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-20"
        >
          {pinned}
        </div>
      ) : null}
      <main
        id="main"
        tabIndex={-1}
        className={cn('min-w-0 flex-1 px-4 pt-4 pb-6 focus:outline-none', mainClassName)}
      >
        {children}
      </main>
      {dock || tabBar ? (
        <div className="sticky bottom-0 z-30">
          {dock}
          {tabBar}
        </div>
      ) : null}
    </div>
  );
}

/**
 * `--partner-sticky-top` (F9 design 1.7): the header's height plus the pinned banner's when it
 * shows, so a day header sticks under both and never hides beneath the banner.
 */
function usePartnerStickyTop(rootRef: React.RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return undefined;
    const update = () => {
      const header = root.querySelector<HTMLElement>(':scope > header');
      const pinned = root.querySelector<HTMLElement>(':scope > [data-partner-pinned]');
      const top = (header?.offsetHeight ?? 0) + (pinned?.offsetHeight ?? 0);
      root.style.setProperty('--partner-sticky-top', `${top}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    const watch = () => {
      observer.disconnect();
      for (const element of root.querySelectorAll(
        ':scope > header, :scope > [data-partner-pinned]',
      )) {
        observer.observe(element);
      }
      update();
    };
    watch();
    const mutations = new MutationObserver(watch);
    mutations.observe(root, { childList: true });
    return () => {
      observer.disconnect();
      mutations.disconnect();
    };
  }, [rootRef]);
}

// ------------------------------------------------------------------ dock (design 2.4)

/** The bottom block's dock: one main action, its blocked reason above it. */
export function Dock({
  children,
  reason,
  reasonIcon: ReasonIcon,
  reasonId,
  withTabBar = false,
}: {
  children: ReactNode;
  reason?: string | null;
  reasonIcon?: LucideIcon;
  reasonId?: string;
  /** Without a tab bar, the dock clears the phone's home indicator itself. */
  withTabBar?: boolean;
}) {
  return (
    <div
      className={cn(
        'border-t border-border bg-card px-4 pt-3 pb-3',
        !withTabBar && 'pb-[max(0.75rem,env(safe-area-inset-bottom))]',
      )}
    >
      {reason ? (
        <p id={reasonId} className="mb-2 flex items-start gap-2 text-body-5 text-foreground">
          {ReasonIcon ? <ReasonIcon className="mt-0.5 size-4 shrink-0" aria-hidden /> : null}
          {reason}
        </p>
      ) : null}
      {children}
    </div>
  );
}

const BLOCKED_DOCK = 'cursor-not-allowed border border-border bg-muted text-muted-foreground';

/**
 * The 56 px main button (design 0.5, 2.4). Blocked: it stays focusable, says why through the
 * reason above it, and repeats the reason when pressed. Pending: after 300 ms a spinner and its
 * pending label; further presses are ignored.
 */
export function DockButton({
  children,
  icon: Icon,
  variant = 'default',
  pending = false,
  pendingLabel,
  blocked = false,
  blockedReason,
  reasonId,
  onPress,
  href,
  type = 'button',
  form,
  buttonRef,
}: {
  children: ReactNode;
  icon?: LucideIcon;
  variant?: 'default' | 'stop' | 'outline';
  pending?: boolean;
  pendingLabel?: string;
  blocked?: boolean;
  blockedReason?: string | null;
  reasonId?: string;
  onPress?: () => void;
  href?: Route | { pathname: Route; query: Record<string, string> };
  type?: 'button' | 'submit';
  form?: string;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  const slow = useSlowPending(pending);
  const inactive = pending || blocked;
  const content =
    slow && pendingLabel ? (
      <>
        <Spinner className="size-5" aria-hidden />
        {pendingLabel}
      </>
    ) : (
      <>
        {Icon ? <Icon className="size-5" aria-hidden /> : null}
        {children}
      </>
    );

  if (href) {
    return (
      <Button asChild size="dock" variant={variant}>
        <Link href={href}>{content}</Link>
      </Button>
    );
  }
  return (
    <Button
      ref={buttonRef}
      type={type}
      form={form}
      size="dock"
      variant={variant}
      aria-disabled={inactive || undefined}
      aria-describedby={blocked && reasonId ? reasonId : undefined}
      className={cn(inactive && 'cursor-not-allowed', blocked && !pending && BLOCKED_DOCK)}
      onClick={(event) => {
        if (inactive) {
          event.preventDefault();
          if (blocked && !pending && blockedReason) announce(blockedReason);
          return;
        }
        onPress?.();
      }}
    >
      {content}
    </Button>
  );
}

// ------------------------------------------------------------------ tab bar

export type PartnerTab = 'home' | 'earnings' | 'profile';

export function PartnerTabBar({ current }: { current: PartnerTab }) {
  const tabs: { key: PartnerTab; label: string; href: Route; icon: LucideIcon }[] = [
    { key: 'home', label: 'Home', href: '/partner', icon: House },
    { key: 'earnings', label: 'Earnings', href: '/partner/earnings', icon: Wallet },
    { key: 'profile', label: 'Profile', href: '/partner/profile', icon: CircleUserRound },
  ];
  return (
    <nav
      aria-label="Partner"
      className="grid h-16 grid-cols-3 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] box-content"
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isCurrent = tab.key === current;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={isCurrent ? 'page' : undefined}
            className={cn(
              'relative flex flex-col items-center justify-center gap-1 text-body-5 font-medium focus-visible:-outline-offset-2',
              isCurrent
                ? 'font-semibold text-strong before:absolute before:inset-x-6 before:top-0 before:h-[3px] before:rounded-b-full before:bg-primary'
                : 'text-muted-foreground hover:text-strong',
            )}
          >
            <Icon className={cn('size-6', isCurrent && 'text-primary')} aria-hidden />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

// ------------------------------------------------------------------ headers (design 2.2)

/** Links outside the app open in the browser when installed; they say so there. */
function ExternalMark() {
  return (
    <ExternalLink
      className="hidden size-4 text-muted-foreground [@media(display-mode:standalone)]:inline"
      aria-hidden
    />
  );
}

/** "Order food", "Account settings", "Sign out" (design 2.2). */
export function PartnerAccountMenu() {
  const signOut = useSignOut();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const signOutOnClose = useRef(false);
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            ref={triggerRef}
            variant="ghost"
            size="icon-kitchen"
            aria-label="Account menu"
            className="text-strong"
          >
            <CircleUserRound className="size-6" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={4}
          className="w-64 border-border bg-card text-foreground"
          onCloseAutoFocus={() => {
            if (!signOutOnClose.current) return;
            signOutOnClose.current = false;
            signOut.request();
          }}
        >
          <DropdownMenuItem asChild className="h-12 text-foreground focus:bg-muted">
            <Link href="/menu">
              Order food
              <ExternalMark />
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="h-12 text-foreground focus:bg-muted">
            <Link href="/account">
              Account settings
              <ExternalMark />
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="h-12 text-foreground focus:bg-muted"
            onSelect={() => {
              signOutOnClose.current = true;
            }}
          >
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <SignOutDialog state={signOut} onCloseFocus={() => triggerRef.current?.focus()} />
    </>
  );
}

export type HeaderStart =
  | { kind: 'logo' }
  | { kind: 'back'; href?: Route; onBack?: () => void }
  | { kind: 'close'; href?: Route; onClose?: () => void };

const LOGO_START: HeaderStart = { kind: 'logo' };

/** Apply, gates, pending, decisions, welcome, suspension, terms. */
export function PlainHeader({
  title = 'Foodz Partner',
  start = LOGO_START,
  menu = true,
}: {
  title?: string;
  start?: HeaderStart;
  menu?: boolean;
}) {
  return (
    <header className={plainHeaderClass}>
      <HeaderStartButton start={start} />
      <p className="min-w-0 flex-1 truncate text-body-3 font-semibold text-strong">{title}</p>
      {menu ? <PartnerAccountMenu /> : <span aria-hidden className="size-12" />}
    </header>
  );
}

function HeaderStartButton({ start }: { start: HeaderStart }) {
  if (start.kind === 'logo') {
    return (
      // The whole wordmark, in brand green in both themes (it reads on the dark page too).
      <span className="flex h-12 shrink-0 items-center px-3">
        <Image
          src="/Logo/logo.svg"
          alt=""
          width={84}
          height={24}
          unoptimized
          className="h-6 w-auto"
        />
      </span>
    );
  }
  const Icon = start.kind === 'back' ? ChevronLeft : X;
  const label = start.kind === 'back' ? 'Back' : 'Close';
  const press = start.kind === 'back' ? start.onBack : start.onClose;
  if (start.href && !press) {
    return (
      <Button asChild variant="ghost" size="icon-kitchen" className="shrink-0 text-strong">
        <Link href={start.href} aria-label={label}>
          <Icon className="size-6" aria-hidden />
        </Link>
      </Button>
    );
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-kitchen"
      aria-label={label}
      className="shrink-0 text-strong"
      onClick={press}
    >
      <Icon className="size-6" aria-hidden />
    </Button>
  );
}

/** Home and Profile: the status is the first and largest thing on screen (D4, D9). */
export function StatusHeader({
  online,
  name,
  photoUrl,
}: {
  online: boolean;
  name: string;
  photoUrl: string | null;
}) {
  const Icon = online ? Navigation : NavigationOff;
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? '';
  return (
    <header className={statusHeaderClass(online)}>
      <p className="flex items-center gap-2 text-body-2 font-semibold">
        <Icon className="size-6" aria-hidden />
        <span aria-hidden>{online ? 'Online' : 'Offline'}</span>
        <span className="sr-only">
          {online ? 'Online, sharing your location' : 'Offline, not sharing your location'}
        </span>
      </p>
      <Link
        href="/partner/profile"
        aria-label="Profile"
        className="-mr-1 ml-auto flex size-12 items-center justify-center rounded-full focus-visible:outline-current"
      >
        {photoUrl ? (
          // A 5-minute private link: drawn as is, never through the image optimizer.
          // oxlint-disable-next-line nextjs/no-img-element
          <img
            src={photoUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="size-10 rounded-full object-cover ring-2 ring-white/70"
          />
        ) : (
          <span
            aria-hidden
            className="flex size-10 items-center justify-center rounded-full bg-white/15 text-body-4 font-semibold ring-2 ring-white/70"
          >
            {initial}
          </span>
        )}
      </Link>
    </header>
  );
}

// ------------------------------------------------------------------ notices (design 2.3)

type Tone = 'muted' | 'warning' | 'success' | 'error';

const TONES: Record<Tone, { box: string; icon: string }> = {
  muted: { box: 'bg-muted', icon: 'text-muted-foreground' },
  warning: { box: 'bg-warning-soft', icon: 'text-warning-mark' },
  success: { box: 'bg-success-soft', icon: 'text-success-mark' },
  error: { box: 'bg-danger-soft', icon: 'text-danger-mark' },
};

/** A banner or notice in the page: what happened to this screen, with an optional Dismiss. */
export function PartnerNotice({
  tone,
  icon: Icon,
  children,
  onDismiss,
  action,
  id,
  noticeRef,
}: {
  tone: Tone;
  icon: LucideIcon;
  children: ReactNode;
  onDismiss?: () => void;
  action?: ReactNode;
  id?: string;
  noticeRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={noticeRef}
      id={id}
      tabIndex={noticeRef ? -1 : undefined}
      className={cn(
        'flex items-start gap-3 rounded-xl px-4 py-3 text-body-4 text-strong outline-none',
        TONES[tone].box,
      )}
    >
      <Icon className={cn('mt-0.5 size-5 shrink-0', TONES[tone].icon)} aria-hidden />
      <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        {children}
        {action ? <div className="mt-3">{action}</div> : null}
      </div>
      {onDismiss ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-kitchen"
          aria-label="Dismiss"
          className="-my-2 -mr-3 shrink-0 text-strong hover:bg-black/5 dark:hover:bg-white/10"
          onClick={onDismiss}
        >
          <X className="size-5" aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}

/** The one pinned banner: the connection (design 2.3, D11). */
export function PinnedBanner({
  tone,
  icon: Icon,
  children,
}: {
  tone: Tone;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 border-b border-border px-4 py-3 text-body-5 font-medium text-strong',
        TONES[tone].box,
      )}
    >
      <Icon className={cn('mt-0.5 size-5 shrink-0', TONES[tone].icon)} aria-hidden />
      <p className="min-w-0 flex-1">{children}</p>
    </div>
  );
}

// ------------------------------------------------------------------ shared page parts (design 5)

/** The hero block of the decision screens. */
export function Hero({
  media,
  title,
  titleRef,
  children,
}: {
  media: ReactNode;
  title: string;
  titleRef?: React.Ref<HTMLHeadingElement>;
  children?: ReactNode;
}) {
  return (
    <div className="pt-8 text-center">
      {media}
      <h1
        ref={titleRef}
        tabIndex={-1}
        className="mt-6 font-heading text-h4 text-strong outline-none [overflow-wrap:anywhere]"
      >
        {title}
      </h1>
      {children ? (
        <div className="mt-3 space-y-2 text-body-4 text-muted-foreground [overflow-wrap:anywhere]">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** A round disc with an icon, for heroes and gates. */
export function IconDisc({
  icon: Icon,
  tone = 'muted',
  size = 'lg',
}: {
  icon: LucideIcon;
  tone?: Tone;
  size?: 'lg' | 'md';
}) {
  const box = tone === 'muted' ? 'bg-muted' : TONES[tone].box;
  const mark = tone === 'muted' ? 'text-foreground' : TONES[tone].icon;
  return (
    <span
      aria-hidden
      className={cn(
        'mx-auto flex items-center justify-center rounded-full',
        size === 'lg' ? 'size-16' : 'size-12',
        box,
      )}
    >
      <Icon className={cn(size === 'lg' ? 'size-8' : 'size-6', mark)} />
    </span>
  );
}

/** A card of label and value rows (design 5's "detail rows"). */
export function DetailRows({
  title,
  rows,
  wideLabels = false,
}: {
  title?: string;
  rows: readonly { label: string; value: ReactNode }[];
  /** Labels up to two words ("Cash collected") on one line from 360 px (F9 review P9). */
  wideLabels?: boolean;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={title ? id : undefined}
      className="rounded-2xl border border-border bg-card"
    >
      {title ? (
        <h2 id={id} className="px-4 pt-4 text-body-3 font-semibold text-strong">
          {title}
        </h2>
      ) : null}
      <dl className="divide-y divide-border">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex min-h-14 flex-col justify-center gap-0.5 px-4 py-3 min-[360px]:flex-row min-[360px]:items-center min-[360px]:justify-start min-[360px]:gap-3"
          >
            <dt
              className={cn(
                'shrink-0 text-body-5 text-muted-foreground',
                wideLabels ? 'w-28' : 'w-20',
              )}
            >
              {row.label}
            </dt>
            <dd className="min-w-0 text-body-4 text-strong [overflow-wrap:anywhere]">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
