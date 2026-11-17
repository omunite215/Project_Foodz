'use client';

import { CircleCheck, Info, type LucideIcon, MailCheck, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { dismissNoticeAction } from '@/server/modules/account/actions';
import { Button } from '@/components/ui/button';
import { postAuthEvent, takeNoticeFocus } from '@/lib/auth-channel';
import { prefersReducedMotion } from '@/lib/motion';
import { NOTICE_COOKIES, type FlashNotice } from '@/lib/notices';
import { cn } from '@/lib/utils';
import { gsap } from 'gsap';
import { PageContainer } from './page-container';

export interface WelcomeNotice {
  firstName: string;
  email: string;
}

const TONES = {
  brand: { strip: 'bg-brand-soft', icon: 'text-brand-strong' },
  neutral: { strip: 'bg-neutral-7', icon: 'text-neutral-3' },
} as const;

function Strip({
  tone,
  icon: Icon,
  focusOnMount,
  onDismiss,
  remember,
  children,
}: {
  tone: keyof typeof TONES;
  icon: LucideIcon;
  /** Asked once, when the strip appears: should it take focus? (S7.6) */
  focusOnMount: () => boolean;
  onDismiss: () => void;
  /** Tells the server at once, before the fade. */
  remember?: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const textId = useId();
  const [takeFocus] = useState(focusOnMount);

  useEffect(() => {
    if (takeFocus) ref.current?.focus();
  }, [takeFocus]);

  const dismiss = () => {
    remember?.();
    const element = ref.current;
    if (!element || prefersReducedMotion()) {
      onDismiss();
      return;
    }
    gsap.to(element, { opacity: 0, duration: 0.16, ease: 'power2.in', onComplete: onDismiss });
  };

  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-labelledby={textId}
      className={cn('border-b border-neutral-6 focus:outline-none', TONES[tone].strip)}
    >
      <PageContainer className="flex items-start gap-3 py-3">
        <Icon className={cn('mt-0.5 size-5 shrink-0', TONES[tone].icon)} aria-hidden />
        <p
          id={textId}
          className="flex-1 text-body-5 text-neutral-1 [overflow-wrap:anywhere] md:text-body-4 [&_a]:font-medium [&_a]:text-neutral-1 [&_a]:underline [&_a]:underline-offset-4"
        >
          {children}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon-touch"
          aria-label="Dismiss"
          onClick={dismiss}
          className="-my-1.5 text-neutral-1 hover:bg-white/60"
        >
          <X className="size-5" aria-hidden />
        </Button>
      </PageContainer>
    </section>
  );
}

const clearFlashCookie = () => {
  document.cookie = `${NOTICE_COOKIES.flash}=; Max-Age=0; path=/; SameSite=Lax`;
};

/**
 * Notices rendered from cookies on the server, as the first thing in <main> (design 1.5), so
 * they never push content after paint:
 * - the welcome notice after sign-up, until dismissed or the email is confirmed;
 * - one-page-view flashes ("Email confirmed…", "Your account has been deleted."), which stay
 *   until dismissed or the next navigation.
 * When a tab showing the welcome notice learns the email was confirmed, it shows the
 * confirmation instead.
 */
export function NoticeArea({
  welcome,
  flash,
  emailVerified,
}: {
  welcome: WelcomeNotice | null;
  flash: FlashNotice | null;
  emailVerified: boolean;
}) {
  const pathname = usePathname();
  const [flashOn, setFlashOn] = useState<{
    notice: FlashNotice;
    path: string;
    focus: boolean;
  } | null>(flash ? { notice: flash, path: pathname, focus: true } : null);
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);

  // New notices from a server render (after an action or a refresh).
  const welcomeEmail = welcome?.email ?? null;
  const [seen, setSeen] = useState({ flash, welcomeEmail, emailVerified });
  if (
    seen.flash !== flash ||
    seen.welcomeEmail !== welcomeEmail ||
    seen.emailVerified !== emailVerified
  ) {
    setSeen({ flash, welcomeEmail, emailVerified });
    if (flash && flash !== seen.flash) setFlashOn({ notice: flash, path: pathname, focus: true });
    // The welcome notice gives way because the email was just confirmed (in another tab).
    if (!welcomeEmail && seen.welcomeEmail && emailVerified) {
      setFlashOn({ notice: 'email-confirmed', path: pathname, focus: false });
    }
  }

  // The flash is for one page view: forget it now, so a reload or the next page does not repeat it.
  useEffect(() => {
    if (!flash) return;
    clearFlashCookie();
    if (flash === 'email-confirmed') postAuthEvent('email-confirmed');
  }, [flash]);

  const shownFlash = flashOn && flashOn.path === pathname ? flashOn : null;
  const flashNotice = shownFlash?.notice ?? null;
  const flashFocus = () => shownFlash?.focus ?? false;

  if (welcome && !welcomeDismissed) {
    return (
      <Strip
        tone="brand"
        icon={MailCheck}
        focusOnMount={takeNoticeFocus}
        remember={() => void dismissNoticeAction({ notice: 'welcome' })}
        onDismiss={() => setWelcomeDismissed(true)}
      >
        Welcome, {welcome.firstName}. We sent a link to {welcome.email} to confirm your email.
        You&apos;ll need it before your first order. Wrong address?{' '}
        <Link href="/account#change-email">Change it</Link>
      </Strip>
    );
  }

  if (flashNotice === 'email-confirmed') {
    return (
      <Strip
        tone="brand"
        icon={CircleCheck}
        focusOnMount={flashFocus}
        onDismiss={() => setFlashOn(null)}
      >
        Email confirmed. You&apos;re ready to order.
      </Strip>
    );
  }

  if (flashNotice === 'account-deleted') {
    return (
      <Strip
        tone="neutral"
        icon={Info}
        focusOnMount={flashFocus}
        onDismiss={() => setFlashOn(null)}
      >
        Your account has been deleted.
      </Strip>
    );
  }

  return null;
}
