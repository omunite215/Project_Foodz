'use client';

import type { ReactNode } from 'react';
import { LoadingRegion } from '@/components/states/loading-region';
import { cn } from '@/lib/utils';
import { useAccount } from './account-context';

/*
 * Loading skeletons for the account pages. Each draws the boxes of the page it stands for, in the
 * state that page will render (confirmed or not, demo or not, how many addresses and devices),
 * read from the account summary the layout already has, so nothing jumps when the page arrives.
 */

const block = 'animate-skeleton bg-neutral-7 motion-reduce:animate-none';

function Bar({ className }: { className?: string }) {
  return <div className={cn(block, 'rounded-md', className)} />;
}

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-2xl border border-neutral-6 bg-white p-5 md:p-6', className)}>
      {children}
    </div>
  );
}

function Head({ subtitle = false }: { subtitle?: boolean }) {
  return (
    <div>
      <Bar className="h-10 w-48 md:h-[50px]" />
      {subtitle ? <Bar className="mt-2 h-6 w-full max-w-80" /> : null}
    </div>
  );
}

function FieldBox({ wide = true }: { wide?: boolean }) {
  return (
    <div>
      <Bar className="h-6 w-16" />
      <Bar className={cn('mt-2 h-11 rounded-xl', wide ? 'w-full' : 'w-40')} />
    </div>
  );
}

export function AccountSkeleton() {
  const account = useAccount();
  return (
    <LoadingRegion label="Loading your account">
      <Head />
      <div className="mt-8 space-y-6">
        <Card>
          <Bar className="h-6 w-20" />
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Bar className="h-6 w-2/3" />
            <Bar className="h-7 w-28" />
          </div>
          {account.emailVerified || account.isDemo ? null : (
            <>
              <Bar className="mt-2 h-[21px] w-full" />
              <Bar className="mt-1 h-[21px] w-1/2" />
              <div className="mt-4 flex flex-wrap gap-3">
                <Bar className="h-11 w-36 rounded-lg" />
                <Bar className="h-11 w-32 rounded-lg" />
              </div>
              <div className="mt-3 min-h-6" />
            </>
          )}
        </Card>
        <Card>
          <Bar className="h-6 w-20" />
          <div className="mt-5 max-w-[524px] space-y-6">
            <FieldBox />
            <div>
              <Bar className="h-6 w-32" />
              <div className="mt-2 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2">
                <Bar className="h-11 rounded-xl" />
                <Bar className="h-11 rounded-xl" />
              </div>
              <Bar className="mt-2 h-[21px] w-3/4" />
            </div>
          </div>
          {account.canEditProfile ? (
            <>
              <Bar className="mt-8 h-11 w-full rounded-lg md:w-40" />
              <div className="mt-3 min-h-6" />
            </>
          ) : (
            <Bar className="mt-8 h-6 w-72 max-w-full" />
          )}
        </Card>
      </div>
      <Bar className="mt-10 h-11 w-full rounded-lg lg:hidden" />
    </LoadingRegion>
  );
}

function AddressCardBox() {
  return (
    <Card className="flex h-full flex-col">
      <div className="flex items-start gap-3">
        <Bar className="size-10 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1">
          <Bar className="h-6 w-24" />
          <Bar className="mt-1 h-6 w-4/5" />
          <Bar className="mt-1 h-[21px] w-1/2" />
        </div>
      </div>
      <div className="mt-auto">
        <div className="mt-4 border-t border-neutral-6 pt-3">
          <Bar className="h-11 w-full rounded-lg" />
        </div>
      </div>
    </Card>
  );
}

export function AddressesSkeleton() {
  const { addressCount } = useAccount();
  return (
    <LoadingRegion label="Loading addresses">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <Head subtitle={addressCount > 0} />
        {addressCount > 0 ? <Bar className="h-11 w-full rounded-lg md:w-48" /> : null}
      </div>
      {addressCount > 0 ? (
        <ul className="mt-6 grid gap-4 md:grid-cols-2 md:gap-6">
          {Array.from({ length: Math.min(addressCount, 6) }, (_, index) => (
            <li key={index}>
              <AddressCardBox />
            </li>
          ))}
        </ul>
      ) : (
        <Card className="mt-6 flex flex-col items-center py-12">
          <Bar className="size-40 md:size-50" />
          <Bar className="mt-6 h-7 w-56" />
          <Bar className="mt-3 h-6 w-64 max-w-full" />
          <Bar className="mt-8 h-11 w-44 rounded-lg" />
        </Card>
      )}
    </LoadingRegion>
  );
}

export function AddressFormSkeleton() {
  return (
    <LoadingRegion label="Loading address">
      <Bar className="h-11 w-48 rounded-lg" />
      <Bar className="mt-6 h-10 w-48 md:h-[50px]" />
      <div className="mt-8 max-w-[640px] space-y-6">
        <FieldBox />
        <div>
          <Bar className="h-[21px] w-64" />
          <Bar className="mt-2 aspect-[16/10] w-full rounded-2xl" />
          <Bar className="mt-3 h-11 w-full rounded-lg" />
        </div>
        <Bar className="min-h-14 w-full rounded-xl" />
        <FieldBox />
        <div>
          <Bar className="h-6 w-56" />
          <Bar className="mt-2 h-[114px] w-full rounded-xl" />
        </div>
        <div className="flex gap-2">
          <Bar className="h-11 w-24 rounded-lg" />
          <Bar className="h-11 w-24 rounded-lg" />
          <Bar className="h-11 w-24 rounded-lg" />
        </div>
        <Bar className="h-11 w-64 rounded-lg" />
        <Bar className="h-11 w-full rounded-lg md:w-44" />
      </div>
    </LoadingRegion>
  );
}

/**
 * One signed-in device: its name (with "This device" on the current one) over when it was
 * active. Below `sm` both lines wrap, as the real row's do.
 */
function DeviceRowBox({ current }: { current: boolean }) {
  return (
    <div className="flex items-center gap-4 py-4">
      <Bar className="size-10 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Bar className="h-6 w-36" />
          {current ? <Bar className="h-7 w-24" /> : null}
        </div>
        <Bar className="h-[42px] w-full sm:h-[21px] sm:w-72" />
      </div>
      {current ? null : <Bar className="h-11 w-20 shrink-0 rounded-lg" />}
    </div>
  );
}

export function SecuritySkeleton() {
  const account = useAccount();
  const rows = account.isDemo ? 1 : Math.max(1, Math.min(account.deviceCount, 5));
  return (
    <LoadingRegion label="Loading security settings">
      <Head />
      <div className="mt-8 space-y-6">
        <Card>
          <Bar className="h-6 w-28" />
          {account.isDemo ? (
            <Bar className="mt-5 h-6 w-72 max-w-full" />
          ) : (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <Bar className="h-6 w-60 max-w-full" />
              <Bar className="h-11 w-44 rounded-lg" />
            </div>
          )}
        </Card>
        {account.twoFactorEnabled ? (
          <Card>
            <Bar className="h-6 w-44" />
            <Bar className="mt-5 h-7 w-full" />
          </Card>
        ) : null}
        <Card>
          <Bar className="h-6 w-44" />
          <Bar className="mt-1 h-[21px] w-64 max-w-full" />
          <div className="mt-5">
            <div className="-mt-1 divide-y divide-neutral-6">
              {Array.from({ length: rows }, (_, index) => (
                <DeviceRowBox key={index} current={index === 0} />
              ))}
            </div>
          </div>
          {account.isDemo ? (
            <Bar className="mt-4 h-[42px] w-full sm:h-[21px] sm:w-96" />
          ) : account.deviceCount > 1 ? (
            <Bar className="mt-4 h-11 w-64 max-w-full rounded-lg" />
          ) : (
            <Bar className="mt-4 h-[21px] w-56 max-w-full" />
          )}
        </Card>
      </div>
    </LoadingRegion>
  );
}

export function PrivacySkeleton() {
  return (
    <LoadingRegion label="Loading privacy settings">
      <Head />
      <div className="mt-8 space-y-6">
        <Card>
          <Bar className="h-6 w-48" />
          <Bar className="mt-1 h-24 w-full md:h-12" />
          <Bar className="mt-5 h-11 w-48 rounded-lg" />
          <div className="mt-3 min-h-6" />
        </Card>
        <Card>
          <Bar className="h-6 w-48" />
          <Bar className="mt-1 h-[42px] w-full sm:h-[21px] sm:w-3/4" />
          <Bar className="mt-5 h-11 w-48 rounded-lg" />
        </Card>
      </div>
    </LoadingRegion>
  );
}
