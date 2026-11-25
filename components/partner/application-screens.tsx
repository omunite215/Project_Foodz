'use client';

import {
  Ban,
  CalendarClock,
  CircleCheck,
  Info,
  MessageSquareText,
  Navigation,
  ShieldCheck,
  Smartphone,
  SquarePen,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { markWelcomedAction, withdrawApplicationAction } from '@/server/modules/partners/actions';
import type { ApplicationSummary, OwnEmail, PartnerState } from '@/server/modules/partners/schema';
import { longDate, weekdayDate } from '@/server/modules/partners/text';
import { SubmitButton } from '@/components/forms/submit-button';
import { SuccessMark } from '@/components/orders/success-mark';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { callAction } from '@/lib/action-result';
import { announce } from '@/lib/announce';
import { rememberEmail } from '@/lib/email-handoff';
import { forgetApplyDraft } from '@/lib/partner/draft';
import { sentLine, shortDay, updatedLine, weekdayDateOf } from '@/lib/partner/text';
import { channels } from '@/lib/realtime/channels';
import { useChannelEvent } from '@/lib/realtime/client';
import { cn } from '@/lib/utils';
import { Doodle } from './doodle';
import { InstallButton } from './install';
import { usePartnerTheme } from './partner-root';
import {
  DetailRows,
  Dock,
  DockButton,
  Hero,
  IconDisc,
  PartnerFrame,
  PartnerNotice,
  PlainHeader,
} from './shell';

/*
 * The decision screens at `/partner` (F6 design 5): pending, sent back, rejected, the approval
 * reaching an open screen, the one-time welcome and the suspension. The server picks the screen;
 * text a reviewer typed is shown exactly as typed, as plain text (P7.7).
 */

const PLAIN_TEXT = 'whitespace-pre-wrap [overflow-wrap:anywhere]';

/** What brought the person here: a save, a decision that beat their save, or a send. */
export type ScreenNotice = 'saved' | 'decided' | 'sent' | null;

function useNotice(initial: ScreenNotice, titleRef?: React.Ref<HTMLHeadingElement>) {
  const [notice, setNotice] = useState(initial === 'sent' ? null : initial);
  const router = useRouter();
  // The notice came in the address; take it out so a reload doesn't show it again.
  useEffect(() => {
    if (!initial) return;
    router.replace('/partner', { scroll: false });
    if (initial === 'sent') {
      // "Application sent" was announced by the form; focus lands on this screen's heading.
      if (titleRef && typeof titleRef === 'object') titleRef.current?.focus();
      return;
    }
    announce(
      initial === 'saved'
        ? 'Changes saved'
        : 'Your application was just reviewed. See the decision below.',
    );
  }, [initial, router, titleRef]);
  return [notice, () => setNotice(null)] as const;
}

function ScreenNotices({ notice, onDismiss }: { notice: ScreenNotice; onDismiss: () => void }) {
  if (notice === 'saved') {
    return (
      <PartnerNotice tone="success" icon={CircleCheck} onDismiss={onDismiss}>
        Changes saved
      </PartnerNotice>
    );
  }
  if (notice === 'decided') {
    return (
      <PartnerNotice tone="muted" icon={Info} onDismiss={onDismiss}>
        Your application was just reviewed. See the decision below.
      </PartnerNotice>
    );
  }
  return null;
}

function WhatYouSent({ application }: { application: ApplicationSummary }) {
  return (
    <DetailRows
      title="What you sent"
      rows={[
        {
          label: 'Photo',
          value: (
            <span className="inline-flex items-center gap-1.5">
              <CircleCheck className="size-4 text-success-mark" aria-hidden />
              Received
            </span>
          ),
        },
        { label: 'Vehicle', value: application.vehicleWords },
        { label: 'ID', value: application.documentWords },
        { label: 'Phone', value: application.phone?.masked ?? '—' },
      ]}
    />
  );
}

// ------------------------------------------------------------------ withdraw (design 5.3)

export function WithdrawDialog({
  open,
  userId,
  onOpenChange,
  returnFocusTo,
}: {
  open: boolean;
  userId: string;
  onOpenChange: (open: boolean) => void;
  /** The button that opened it: it isn't a Radix trigger, so focus is put back by hand (P17.4). */
  returnFocusTo?: React.RefObject<HTMLElement | null>;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);

  const withdraw = async () => {
    if (pending) return;
    setPending(true);
    setFailed(false);
    const outcome = await callAction(() => withdrawApplicationAction({}));
    if (outcome.ok) {
      forgetApplyDraft(userId);
      router.replace('/partner/apply?done=withdrawn');
      return;
    }
    setPending(false);
    setFailed(true);
    announce("We couldn't withdraw your application. Try again.");
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) {
          onOpenChange(next);
          if (!next) setFailed(false);
        }
      }}
    >
      <AlertDialogContent
        className="border border-border bg-card text-foreground"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          keepRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          if (!returnFocusTo?.current) return;
          event.preventDefault();
          returnFocusTo.current.focus();
        }}
      >
        <AlertDialogTitle className="font-heading text-title-2 text-strong">
          Withdraw your application?
        </AlertDialogTitle>
        <AlertDialogDescription className="mt-3 text-body-4 text-foreground">
          We&apos;ll delete your photos and ID details now. You can apply again whenever you like.
        </AlertDialogDescription>
        {failed ? (
          <p className="mt-4 rounded-xl bg-danger-soft px-4 py-3 text-body-5 text-strong">
            We couldn&apos;t withdraw your application. Try again.
          </p>
        ) : null}
        <div className="mt-6 flex flex-col-reverse gap-3">
          <Button
            ref={keepRef}
            type="button"
            variant="outline"
            size="kitchen"
            aria-disabled={pending || undefined}
            onClick={() => {
              if (!pending) onOpenChange(false);
            }}
          >
            Keep application
          </Button>
          <SubmitButton
            type="button"
            size="kitchen"
            variant="danger"
            pending={pending}
            pendingLabel="Withdrawing…"
            onClick={() => void withdraw()}
          >
            Withdraw
          </SubmitButton>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function WaitingActions({ userId, withEdit }: { userId: string; withEdit: boolean }) {
  const [withdrawing, setWithdrawing] = useState(false);
  const withdrawRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="mt-6 flex flex-col gap-3">
      {withEdit ? (
        <Button asChild variant="outline" size="kitchen" className="w-full">
          <Link href={{ pathname: '/partner/apply', query: { mode: 'edit', step: '4' } }}>
            <SquarePen className="size-5" aria-hidden />
            Edit application
          </Link>
        </Button>
      ) : null}
      <Button asChild variant="ghost" size="kitchen" className="w-full text-strong">
        <Link href="/menu">Order food while you wait</Link>
      </Button>
      <Button
        ref={withdrawRef}
        type="button"
        variant="ghost"
        size="kitchen"
        className="w-full text-destructive hover:text-destructive"
        onClick={() => setWithdrawing(true)}
      >
        Withdraw application
      </Button>
      <WithdrawDialog
        open={withdrawing}
        userId={userId}
        onOpenChange={setWithdrawing}
        returnFocusTo={withdrawRef}
      />
    </div>
  );
}

// ------------------------------------------------------------------ pending (design 5.1)

export function PendingScreen({
  application,
  email,
  userId,
  timeZone,
  notice: initialNotice = null,
  titleRef,
}: {
  application: ApplicationSummary;
  email: OwnEmail;
  userId: string;
  timeZone: string;
  notice?: ScreenNotice;
  titleRef?: React.Ref<HTMLHeadingElement>;
}) {
  const [notice, dismiss] = useNotice(initialNotice, titleRef);
  return (
    <PartnerFrame header={<PlainHeader />}>
      <div className="space-y-3">
        <ScreenNotices notice={notice} onDismiss={dismiss} />
      </div>
      <Hero
        titleRef={titleRef}
        media={<Doodle name="coffee" className="w-40 max-[359px]:w-30" />}
        title="We're checking your application"
      >
        <p>
          This usually takes up to 2 working days. We&apos;ll email you at {email.masked} and show
          the decision here.
        </p>
        <p className="text-body-5">
          {sentLine(application.submittedAt, timeZone)}
          {application.updatedAt ? (
            <span className="block">{updatedLine(application.updatedAt, timeZone)}</span>
          ) : null}
        </p>
      </Hero>
      <div className="mt-8">
        <WhatYouSent application={application} />
      </div>
      <WaitingActions userId={userId} withEdit />
    </PartnerFrame>
  );
}

// ------------------------------------------------------------------ sent back (design 5.2)

export function SentBackScreen({
  application,
  sentBack,
  userId,
  timeZone,
  notice: initialNotice = null,
  titleRef,
}: {
  application: ApplicationSummary;
  sentBack: { at: string; message: string };
  userId: string;
  timeZone: string;
  notice?: ScreenNotice;
  titleRef?: React.Ref<HTMLHeadingElement>;
}) {
  const [notice, dismiss] = useNotice(initialNotice, titleRef);
  return (
    <PartnerFrame
      header={<PlainHeader />}
      dock={
        <Dock>
          <DockButton href={{ pathname: '/partner/apply', query: { mode: 'fix', step: '4' } }}>
            Fix it
          </DockButton>
        </Dock>
      }
    >
      <div className="space-y-3">
        <ScreenNotices notice={notice} onDismiss={dismiss} />
      </div>
      <Hero
        titleRef={titleRef}
        media={<IconDisc icon={MessageSquareText} tone="warning" />}
        title="We need one thing from you"
      />
      <section className="mt-6 rounded-2xl border border-border bg-card p-4 text-left">
        <p className="text-body-5 text-muted-foreground">From the Foodz team</p>
        <p className={cn('mt-2 text-body-4 text-strong', PLAIN_TEXT)}>{sentBack.message}</p>
      </section>
      <p className="mt-4 text-body-4 text-foreground">
        Being sent back isn&apos;t a rejection. Nothing has been deleted, and you keep your place in
        line.
      </p>
      <p className="mt-2 text-body-5 text-muted-foreground">
        {sentLine(application.submittedAt, timeZone)} · sent back {shortDay(sentBack.at, timeZone)}
      </p>
      <div className="mt-6">
        <WhatYouSent application={application} />
      </div>
      <WaitingActions userId={userId} withEdit={false} />
    </PartnerFrame>
  );
}

// ------------------------------------------------------------------ rejected (design 5.7)

export function RejectedScreen({
  state,
  notice: initialNotice = null,
  titleRef,
}: {
  state: Extract<PartnerState, { screen: 'rejected' }>;
  notice?: ScreenNotice;
  titleRef?: React.Ref<HTMLHeadingElement>;
}) {
  const [notice, dismiss] = useNotice(initialNotice, titleRef);
  return (
    <PartnerFrame
      header={<PlainHeader />}
      dock={
        state.canReapply ? (
          <Dock>
            <DockButton href="/partner/apply">Apply again</DockButton>
          </Dock>
        ) : undefined
      }
    >
      <div className="space-y-3">
        <ScreenNotices notice={notice} onDismiss={dismiss} />
      </div>
      <Hero
        titleRef={titleRef}
        media={<IconDisc icon={CalendarClock} />}
        title="Your application wasn't approved"
      />
      <section className="mt-6 space-y-3 rounded-2xl border border-border bg-card p-4 text-left text-body-4 text-foreground">
        {state.reason ? (
          <p className={PLAIN_TEXT}>
            <span className="font-semibold text-strong">Reason:</span> {state.reason}
          </p>
        ) : (
          <p>
            We can&apos;t share more detail here. If you have questions,{' '}
            <Link href="/contact" className="font-medium text-strong underline underline-offset-4">
              contact us
            </Link>
            .
          </p>
        )}
        {state.canReapply ? (
          <>
            <p>You can apply again now.</p>
            {state.filesDeletedAt ? <p>We&apos;ve deleted your photos and ID details.</p> : null}
          </>
        ) : (
          <>
            <p>You can apply again from {weekdayDate(state.reapplyFrom)}.</p>
            {state.filesDeleteOn ? (
              <p>
                We&apos;ll delete your photos and ID details on {longDate(state.filesDeleteOn)}.
              </p>
            ) : null}
          </>
        )}
      </section>
      <div className="mt-6 space-y-3 text-body-4 text-foreground">
        {state.reason ? (
          <p>
            Questions?{' '}
            <Link href="/contact" className="font-medium text-strong underline underline-offset-4">
              Contact us
            </Link>
            .
          </p>
        ) : null}
        <Button asChild variant="outline" size="kitchen" className="w-full">
          <Link href="/menu">Order food</Link>
        </Button>
      </div>
    </PartnerFrame>
  );
}

// ------------------------------------------------------------------ approved, open screen (5.5)

export function ApprovedSignedOut({
  email,
  titleRef,
}: {
  email: string | null;
  titleRef?: React.Ref<HTMLHeadingElement>;
}) {
  const { resolved } = usePartnerTheme();
  return (
    <PartnerFrame
      header={<PlainHeader menu={false} />}
      dock={
        <Dock>
          <Button asChild size="dock">
            <Link
              href={{ pathname: '/sign-in', query: { callbackUrl: '/partner' } }}
              onClick={() => {
                if (email) rememberEmail(email);
              }}
            >
              Sign in
            </Link>
          </Button>
        </Dock>
      }
    >
      <Hero
        titleRef={titleRef}
        // The animation's colours are baked in for light; dark shows its last frame in the
        // partner's colours (deliberate, design review P9).
        media={<SuccessMark state="placed" play={resolved === 'light'} tone="partner" />}
        title="You're approved"
      >
        <p>For your security we&apos;ve signed you out. Sign in again to open the partner app.</p>
      </Hero>
    </PartnerFrame>
  );
}

// ------------------------------------------------------------------ welcome (design 5.6)

export function WelcomeScreen({ firstName }: { firstName: string }) {
  const router = useRouter();
  const { resolved } = usePartnerTheme();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const goToApp = async () => {
    setPending(true);
    setFailed(null);
    const outcome = await callAction(() => markWelcomedAction({}));
    if (outcome.ok) {
      router.refresh();
      return;
    }
    setPending(false);
    setFailed(outcome.error.message);
    announce(outcome.error.message);
  };

  const items: { icon: typeof Navigation; text: string }[] = [
    { icon: Navigation, text: "Go online when you're ready to deliver." },
    { icon: ShieldCheck, text: "We see your location only while you're online." },
    { icon: Smartphone, text: "Keep Foodz open on screen while you're online." },
  ];

  return (
    <PartnerFrame
      header={<PlainHeader />}
      dock={
        <Dock reason={failed}>
          <DockButton pending={pending} pendingLabel="Opening…" onPress={() => void goToApp()}>
            Go to the app
          </DockButton>
        </Dock>
      }
    >
      <Hero
        media={<SuccessMark state="placed" play={resolved === 'light'} tone="partner" />}
        title={`You're approved, ${firstName}`}
      />
      <ul className="mt-8 space-y-4 text-left">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.text} className="flex items-start gap-3 text-body-4 text-foreground">
              <span
                aria-hidden
                className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-success-soft"
              >
                <Icon className="size-5 text-success-mark" />
              </span>
              <span className="pt-2">{item.text}</span>
            </li>
          );
        })}
      </ul>
      <div className="mt-8">
        <InstallButton />
      </div>
    </PartnerFrame>
  );
}

// ------------------------------------------------------------------ suspended (design 5.8)

export function SuspendedScreen({
  since,
  reason,
  timeZone,
}: {
  since: string;
  reason: string | null;
  timeZone: string;
}) {
  return (
    <PartnerFrame header={<PlainHeader />}>
      <Hero media={<IconDisc icon={Ban} tone="error" />} title="Your partner account is suspended">
        <p>Since {weekdayDateOf(since, timeZone)}</p>
      </Hero>
      {reason ? (
        <section className="mt-6 rounded-2xl border border-border bg-card p-4 text-left text-body-4 text-foreground">
          <p className={PLAIN_TEXT}>
            <span className="font-semibold text-strong">Reason:</span> {reason}
          </p>
        </section>
      ) : null}
      <p className="mt-6 text-body-4 text-foreground">
        If you think this is a mistake,{' '}
        <Link href="/contact" className="font-medium text-strong underline underline-offset-4">
          contact us
        </Link>
        .
      </p>
      <Button asChild variant="outline" size="kitchen" className="mt-6 w-full">
        <Link href="/menu">Order food</Link>
      </Button>
    </PartnerFrame>
  );
}

// ------------------------------------------------------------------ live changes (design 5.4)

type ApplicationState = Extract<PartnerState, { screen: 'pending' | 'sentBack' | 'rejected' }>;

const LIVE_ANNOUNCEMENTS: Partial<Record<string, string>> = {
  'partner.approved':
    "You're approved. For your security we've signed you out. Sign in again to open the partner app.",
  'partner.rejected': "Your application wasn't approved.",
  'partner.sent-back': 'We need one thing from you.',
  'partner.reopened': "We're taking another look at your application.",
};

/**
 * The pending, sent-back and rejected screens, kept current: a decision reaches an open screen
 * within seconds through `notification.created`, and the screen refreshes when the tab comes
 * back. An approval is drawn from the event alone, because the session ends right after (B6). A
 * change the person didn't cause never moves focus, unless what was focused disappears.
 */
export function ApplicationScreens({
  state,
  userId,
  timeZone,
  notice,
}: {
  state: ApplicationState;
  userId: string;
  timeZone: string;
  notice: ScreenNotice;
}) {
  const router = useRouter();
  const [approved, setApproved] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastScreen = useRef(state.screen);
  const focusInside = useRef(false);

  const email = state.screen === 'rejected' ? null : state.email.full;

  useChannelEvent(channels.user(userId), 'notification.created', (event) => {
    if (event.kind !== 'partner') return;
    const words = LIVE_ANNOUNCEMENTS[event.type];
    if (!words) return;
    focusInside.current = Boolean(containerRef.current?.contains(document.activeElement));
    if (event.type === 'partner.approved') {
      setApproved(true);
    } else {
      router.refresh();
    }
    announce(words);
  });

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [router]);

  // The old content went with the focused control: focus the new heading (F5 D25).
  useEffect(() => {
    if (lastScreen.current === state.screen && !approved) return;
    lastScreen.current = state.screen;
    if (focusInside.current && !containerRef.current?.contains(document.activeElement)) {
      titleRef.current?.focus();
    }
    focusInside.current = false;
  }, [state.screen, approved]);

  let screen: ReactNode;
  if (approved) {
    screen = <ApprovedSignedOut email={email} titleRef={titleRef} />;
  } else if (state.screen === 'pending') {
    screen = (
      <PendingScreen
        application={state.application}
        email={state.email}
        userId={userId}
        timeZone={timeZone}
        notice={notice}
        titleRef={titleRef}
      />
    );
  } else if (state.screen === 'sentBack') {
    screen = (
      <SentBackScreen
        application={state.application}
        sentBack={state.sentBack}
        userId={userId}
        timeZone={timeZone}
        notice={notice}
        titleRef={titleRef}
      />
    );
  } else {
    screen = <RejectedScreen state={state} notice={notice} titleRef={titleRef} />;
  }
  return <div ref={containerRef}>{screen}</div>;
}
