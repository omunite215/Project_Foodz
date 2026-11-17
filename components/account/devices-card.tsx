'use client';

import { Laptop, Monitor, Smartphone, Tablet, type LucideIcon } from 'lucide-react';
import { gsap } from 'gsap';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { signOutDeviceAction, signOutOtherDevicesAction } from '@/server/modules/account/actions';
import type { DeviceDto } from '@/server/modules/account/schema';
import { StatusLine } from '@/components/forms/status-line';
import { SubmitButton } from '@/components/forms/submit-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { callAction } from '@/lib/action-result';
import { deviceActivityText, deviceName } from '@/lib/account-text';
import { announce } from '@/lib/announce';
import { prefersReducedMotion } from '@/lib/motion';
import { useAccount } from './account-context';
import { SettingsCard } from './settings-card';

const ICONS: Record<DeviceDto['type'], LucideIcon> = {
  phone: Smartphone,
  tablet: Tablet,
  computer: Laptop,
  unknown: Monitor,
};

/** Fades a row out (160 ms), then calls `done`; at once under reduced motion. */
function fadeOut(element: Element | null, done: () => void) {
  if (!element || prefersReducedMotion()) {
    done();
    return;
  }
  gsap.to(element, { opacity: 0, duration: 0.16, ease: 'power2.in', onComplete: done });
}

/**
 * Where the account is signed in (S5.6, S5.7): this device first, no IP addresses. Another device
 * can be signed out on its own or all at once; focus moves to the next row, or the card heading.
 */
export function DevicesCard({
  devices,
  now,
  timeZone,
}: {
  devices: DeviceDto[] | null;
  now: string;
  /** Dates read the same on the server and in the browser: the store's zone. */
  timeZone: string;
}) {
  const account = useAccount();
  const router = useRouter();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [allBusy, setAllBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const today = new Date(now);

  if (!devices) {
    return (
      <SettingsCard
        id="devices"
        title="Signed-in devices"
        description="Where your account is signed in right now."
      >
        <p className="text-body-5 text-neutral-3">We couldn&apos;t load your devices.</p>
        <Button
          type="button"
          variant="outline"
          size="touch"
          className="mt-3 bg-white"
          onClick={() => router.refresh()}
        >
          Try again
        </Button>
      </SettingsCard>
    );
  }

  const shown = devices.filter((device) => !removed.has(device.id));
  const others = shown.filter((device) => !device.isCurrent);
  const canSignOut = !account.isDemo;

  async function signOutOne(device: DeviceDto) {
    if (busyId || allBusy) return;
    setBusyId(device.id);
    setProblem(null);
    const outcome = await callAction(() => signOutDeviceAction({ id: device.id }));
    setBusyId(null);
    if (!outcome.ok && outcome.error.code !== 'NOT_FOUND') {
      setProblem(outcome.error.message);
      announce(outcome.error.message);
      return;
    }
    const name = deviceName(device.label);
    const row =
      [...(listRef.current?.querySelectorAll<HTMLElement>('li[data-device]') ?? [])].find(
        (item) => item.dataset.device === device.id,
      ) ?? null;
    const before = [
      ...(listRef.current?.querySelectorAll<HTMLButtonElement>('button[data-sign-out]') ?? []),
    ];
    const index = before.findIndex((button) => row?.contains(button));
    fadeOut(row, () => {
      setRemoved((current) => new Set([...current, device.id]));
      requestAnimationFrame(() => {
        const buttons = [
          ...(listRef.current?.querySelectorAll<HTMLButtonElement>('button[data-sign-out]') ?? []),
        ];
        (buttons[Math.min(Math.max(index, 0), buttons.length - 1)] ?? headingRef.current)?.focus();
      });
      announce(`Signed out ${name}`);
    });
  }

  async function signOutAll() {
    if (busyId || allBusy) return;
    setAllBusy(true);
    setProblem(null);
    const outcome = await callAction(() => signOutOtherDevicesAction());
    setAllBusy(false);
    if (!outcome.ok) {
      setProblem(outcome.error.message);
      announce(outcome.error.message);
      return;
    }
    setRemoved(new Set(others.map((device) => device.id)));
    const count = outcome.data.signedOut;
    headingRef.current?.focus();
    announce(`Signed out of ${count} other ${count === 1 ? 'device' : 'devices'}`);
  }

  return (
    <SettingsCard
      id="devices"
      title="Signed-in devices"
      description="Where your account is signed in right now."
      headingRef={headingRef}
    >
      <ul ref={listRef} className="-mt-1 divide-y divide-neutral-6">
        {shown.map((device) => {
          const Icon = ICONS[device.type];
          const name = deviceName(device.label);
          return (
            <li key={device.id} data-device={device.id} className="flex items-center gap-4 py-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-neutral-7">
                <Icon className="size-5 text-neutral-2" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="text-body-4 font-medium text-neutral-1">{name}</span>
                  {device.isCurrent ? <Badge variant="neutral">This device</Badge> : null}
                </p>
                <p className="text-body-5 text-muted-foreground">
                  {deviceActivityText(device, today, timeZone)}
                </p>
              </div>
              {device.isCurrent || !canSignOut ? null : (
                <SubmitButton
                  type="button"
                  data-sign-out=""
                  variant="ghost"
                  pending={busyId === device.id}
                  pendingLabel="Signing out…"
                  aria-label={`Sign out ${name}`}
                  onClick={() => void signOutOne(device)}
                  className="shrink-0 px-3 text-neutral-2 hover:bg-neutral-7"
                >
                  Sign out
                </SubmitButton>
              )}
            </li>
          );
        })}
      </ul>
      {account.isDemo ? (
        <p className="mt-4 text-body-5 text-neutral-3">
          Other visitors&apos; devices aren&apos;t shown on the shared demo account.
        </p>
      ) : others.length > 0 ? (
        <SubmitButton
          type="button"
          variant="outline"
          pending={allBusy}
          pendingLabel="Signing out…"
          onClick={() => void signOutAll()}
          className="mt-4 border-neutral-6 bg-white text-neutral-2 hover:bg-neutral-7"
        >
          Sign out of all other devices
        </SubmitButton>
      ) : (
        <p className="mt-4 text-body-5 text-muted-foreground">No other devices are signed in.</p>
      )}
      {problem ? <StatusLine tone="error">{problem}</StatusLine> : null}
    </SettingsCard>
  );
}
