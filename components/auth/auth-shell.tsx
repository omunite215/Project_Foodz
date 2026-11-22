import { Bike, Bookmark, CookingPot, MapPin } from 'lucide-react';
import Image from 'next/image';
import type { ReactNode } from 'react';
import { PageContainer } from '@/components/layout/page-container';
import { radiusText } from '@/lib/account-text';
import { loadStoreStatus } from '@/lib/storefront-data';

/**
 * The benefits panel beside the sign-in forms from 1024 px (Figma Contact layout, design 3.1).
 * It bleeds to the container's edge; its wrapper clips it, so the page never scrolls sideways.
 * The illustration is decorative and never animated.
 */
async function AuthPanel() {
  const status = await loadStoreStatus();
  const street = status?.store.addressText.split(',')[0]?.trim() ?? '88 Harbor Street';
  const radius = radiusText(status?.delivery.radiusKm ?? 8);
  const minutes = status?.delivery.promiseMinutes ?? 45;
  const benefits = [
    { icon: CookingPot, text: 'Cooked to order in our Boston kitchen' },
    { icon: Bike, text: `At your door in about ${minutes} minutes` },
    { icon: MapPin, text: `We deliver within ${radius} of ${street}` },
    { icon: Bookmark, text: 'Save your addresses for a faster checkout' },
  ];

  return (
    <aside
      aria-labelledby="auth-panel-title"
      className="hidden min-h-[640px] flex-col bg-brand-soft px-12 py-15 lg:-mr-12 lg:flex xl:-mr-[72px] xl:min-h-[760px] xl:px-16 xl:py-20 min-[90rem]:px-20"
    >
      <h2
        id="auth-panel-title"
        className="max-w-[14ch] font-heading text-h3 leading-tight text-balance text-neutral-1 xl:text-h2"
      >
        Good food, delivered warm.
      </h2>
      <ul className="mt-8 space-y-4">
        {benefits.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-center gap-4 text-body-4 text-neutral-1">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-neutral-8">
              <Icon className="size-5 text-brand-strong" aria-hidden />
            </span>
            {text}
          </li>
        ))}
      </ul>
      <Image
        src="/illustrations/eating-together.svg"
        alt=""
        width={440}
        height={471}
        unoptimized
        className="mt-auto w-full max-w-[360px] self-center pt-10 xl:max-w-[440px]"
      />
    </aside>
  );
}

/**
 * The sign-in pages' layout: the form straight under the header on phones and tablets (S7.1),
 * and the form beside the benefits panel from `lg`.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden">
      <PageContainer>
        <div className="lg:grid lg:grid-cols-[minmax(0,462fr)_minmax(0,426fr)] lg:gap-x-10 xl:grid-cols-[minmax(0,524fr)_minmax(0,636fr)] xl:gap-x-24 min-[90rem]:gap-x-[136px]">
          <div className="w-full pt-10 pb-15 md:mx-auto md:max-w-[462px] md:pt-15 md:pb-20 lg:mx-0 lg:py-20 xl:max-w-[524px] xl:pt-20 xl:pb-24">
            {children}
          </div>
          <AuthPanel />
        </div>
      </PageContainer>
    </div>
  );
}

/** The centred result layout for email-link pages (design 3.7). */
export function ResultShell({ children }: { children: ReactNode }) {
  return (
    <PageContainer>
      <div className="mx-auto max-w-md py-15 text-center md:py-20">{children}</div>
    </PageContainer>
  );
}
