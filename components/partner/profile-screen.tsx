'use client';

import {
  ChevronRight,
  FileText,
  Lock,
  LogOut,
  Moon,
  Settings,
  Star,
  Sun,
  SunMoon,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { PartnerState } from '@/server/modules/partners/schema';
import { SignOutDialog, useSignOut } from '@/components/layout/sign-out';
import { SubmitButton } from '@/components/forms/submit-button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  goOffline,
  keepScreenOnSetting,
  setKeepScreenOn,
  wakeLockSupported,
} from '@/lib/partner/sharing';
import { monthDayYear, type PartnerTheme } from '@/lib/partner/text';
import { cn } from '@/lib/utils';
import { PinnedConnectionBanner, usePartnerSession } from './home/partner-home';
import { SuspensionCover } from './home/home-parts';
import { usePartnerTheme } from './partner-root';
import { PartnerFrame, PartnerTabBar, StatusHeader } from './shell';

/*
 * Profile (F6 design 6.7): who he is, the appearance (this phone's own choice, written to a
 * cookie so the next first paint is right), keeping the screen on, and signing out. Signing out
 * while online goes offline first, exactly like "Go offline".
 */

type Home = Extract<PartnerState, { screen: 'home' }>;

const THEMES: { value: PartnerTheme; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: 'System', icon: SunMoon },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

const subscribeNothing = () => () => {};

function AppearanceControl() {
  const { theme, setTheme } = usePartnerTheme();
  const id = useId();
  return (
    <fieldset className="min-w-0">
      <legend id={id} className="text-body-3 font-semibold text-strong">
        Appearance
      </legend>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {THEMES.map((choice) => {
          const Icon = choice.icon;
          return (
            <label
              key={choice.value}
              className="group relative flex h-12 cursor-pointer items-center justify-center gap-2 rounded-lg border border-input bg-card px-2 text-body-4 text-strong has-[:checked]:border-2 has-[:checked]:border-primary has-[:checked]:bg-success-soft has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-solid"
            >
              <input
                type="radio"
                name="appearance"
                value={choice.value}
                checked={theme === choice.value}
                onChange={() => setTheme(choice.value)}
                className="sr-only"
              />
              <Icon className="size-5" aria-hidden />
              {choice.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function KeepScreenOn() {
  const supported = useSyncExternalStore(subscribeNothing, wakeLockSupported, () => false);
  const [on, setOn] = useState(true);
  const id = useId();
  useEffect(() => {
    const timer = setTimeout(() => setOn(keepScreenOnSetting()), 0);
    return () => clearTimeout(timer);
  }, []);
  if (!supported) return null;
  return (
    <div className="flex min-h-14 items-center justify-between gap-4">
      <label htmlFor={id} className="text-body-4 text-strong">
        Keep the screen on while I&apos;m online
      </label>
      <Switch
        id={id}
        checked={on}
        onCheckedChange={(next) => {
          setOn(next);
          setKeepScreenOn(next);
        }}
        className="h-7 w-12 data-[size=default]:h-7 data-[size=default]:w-12 [&>span]:size-6! [&>span]:data-checked:translate-x-5!"
      />
    </div>
  );
}

export function ProfileScreen({ state, asOf }: { state: Home; asOf: string }) {
  const { sharing, online } = usePartnerSession(state, asOf);
  const signOut = useSignOut();
  const [confirming, setConfirming] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const signOutRef = useRef<HTMLButtonElement>(null);
  const stayRef = useRef<HTMLButtonElement>(null);
  const partner = state.partner;
  const initial = Array.from(partner.name.trim())[0]?.toUpperCase() ?? '';

  const signOutNow = () => signOut.request();

  const rowClass =
    'flex h-14 w-full items-center gap-3 px-4 text-left text-body-4 text-strong hover:bg-muted focus-visible:-outline-offset-2';

  return (
    <>
      <div inert={sharing.suspended ? true : undefined}>
        <PartnerFrame
          header={
            <StatusHeader
              online={online}
              name={partner.name}
              photoUrl={partner.photo?.url ?? null}
            />
          }
          pinned={<PinnedConnectionBanner pinned={sharing.pinned} />}
          tabBar={<PartnerTabBar current="profile" />}
          mainClassName="pt-6 space-y-8"
        >
          <section className="text-center">
            {partner.photo?.url ? (
              // A 5-minute private link to his own photo.
              // oxlint-disable-next-line nextjs/no-img-element
              <img
                src={partner.photo.url}
                alt=""
                referrerPolicy="no-referrer"
                className="mx-auto size-18 rounded-full object-cover"
              />
            ) : (
              <span
                aria-hidden
                className="mx-auto flex size-18 items-center justify-center rounded-full bg-muted font-heading text-title-1 text-strong"
              >
                {initial}
              </span>
            )}
            <h1 className="mt-3 font-heading text-title-1 text-strong [overflow-wrap:anywhere]">
              {partner.name}
            </h1>
            <p className="mt-1 text-body-4 text-foreground">{partner.vehicleWords}</p>
            <p className="mt-1 text-body-5 text-muted-foreground">
              {partner.rating ? (
                <span className="inline-flex items-center gap-1">
                  <Star className="size-3.5" aria-hidden />
                  {partner.rating.average.toFixed(1)} · {partner.rating.count} ratings
                </span>
              ) : (
                'New partner'
              )}{' '}
              · Partner since {monthDayYear(partner.partnerSince, state.kitchen.timeZone)}
            </p>
            {partner.isDemo ? (
              <p className="mt-3 inline-flex items-center gap-1.5 text-body-5 text-muted-foreground">
                <Lock className="size-4" aria-hidden />
                The demo partner&apos;s profile can&apos;t be changed.
              </p>
            ) : (
              <p className="mt-3 text-body-5 text-muted-foreground">
                To change your vehicle or photo,{' '}
                <Link
                  href="/contact"
                  className="font-medium text-strong underline underline-offset-4"
                >
                  contact us
                </Link>
                .
              </p>
            )}
          </section>

          <AppearanceControl />
          <KeepScreenOn />

          <nav
            aria-label="Account"
            className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card"
          >
            <Link href="/account/security" className={rowClass}>
              <Settings className="size-5 text-muted-foreground" aria-hidden />
              <span className="flex-1">Account settings</span>
              <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
            </Link>
            <Link href="/partner/terms" className={rowClass}>
              <FileText className="size-5 text-muted-foreground" aria-hidden />
              <span className="flex-1">Partner Terms</span>
              <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
            </Link>
            <button
              ref={signOutRef}
              type="button"
              className={rowClass}
              onClick={() => {
                if (online && !sharing.isDemo) setConfirming(true);
                else signOutNow();
              }}
            >
              <LogOut className="size-5 text-muted-foreground" aria-hidden />
              <span className="flex-1">Sign out</span>
            </button>
          </nav>
        </PartnerFrame>
      </div>

      <AlertDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!leaving) setConfirming(open);
        }}
      >
        <AlertDialogContent
          className="border border-border bg-card text-foreground"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            stayRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            signOutRef.current?.focus();
          }}
        >
          <AlertDialogTitle className="font-heading text-title-2 text-strong">
            You&apos;re online
          </AlertDialogTitle>
          <AlertDialogDescription className="mt-3 text-body-4 text-foreground">
            Signing out takes you offline and stops sharing your location.
          </AlertDialogDescription>
          <div className="mt-6 flex flex-col-reverse gap-3">
            <Button
              ref={stayRef}
              type="button"
              variant="outline"
              size="kitchen"
              aria-disabled={leaving || undefined}
              onClick={() => {
                if (!leaving) setConfirming(false);
              }}
            >
              Stay online
            </Button>
            <SubmitButton
              type="button"
              size="kitchen"
              variant="stop"
              pending={leaving}
              pendingLabel="Signing out…"
              onClick={() => {
                setLeaving(true);
                void (async () => {
                  await goOffline();
                  setConfirming(false);
                  setLeaving(false);
                  signOutNow();
                })();
              }}
              className={cn('w-full')}
            >
              Go offline and sign out
            </SubmitButton>
          </div>
        </AlertDialogContent>
      </AlertDialog>
      <SignOutDialog state={signOut} onCloseFocus={() => signOutRef.current?.focus()} />
      {sharing.suspended ? <SuspensionCover how={sharing.suspended} /> : null}
    </>
  );
}
