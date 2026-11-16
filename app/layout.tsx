import './globals.css';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { ANNOUNCEMENT_COOKIE } from '@/components/layout/announcement';
import { AnnouncementBar } from '@/components/layout/announcement-bar';
import { LiveAnnouncer } from '@/components/layout/live-announcer';
import { RouteMemory } from '@/components/layout/route-memory';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { SkipLink } from '@/components/layout/skip-link';
import { Providers } from '@/components/providers';
import { fontVariables } from '@/lib/fonts';
import { loadAnnouncement, loadStoreStatus } from '@/lib/storefront-data';
import { cn } from '@/lib/utils';

export const metadata: Metadata = {
  title: { default: 'Foodz', template: '%s | Foodz' },
  description: 'Korean, Thai and Vietnamese food, delivered hot.',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Every page renders per request so its scripts can carry the CSP nonce.
  await connection();

  const [status, announcement, cookieStore] = await Promise.all([
    loadStoreStatus(),
    loadAnnouncement(),
    cookies(),
  ]);
  const showAnnouncement =
    announcement !== null && cookieStore.get(ANNOUNCEMENT_COOKIE)?.value !== announcement.id;

  return (
    <html
      lang="en"
      className={cn(fontVariables, 'motion-safe:scroll-smooth')}
      data-scroll-behavior="smooth"
    >
      <body className="bg-neutral-8 font-poppins text-neutral-2 antialiased">
        <Providers>
          <SkipLink />
          {showAnnouncement ? (
            <AnnouncementBar
              campaignId={announcement.id}
              title={announcement.title}
              subtitle={announcement.subtitle}
              code={announcement.coupon?.code ?? null}
            />
          ) : null}
          <SiteHeader />
          <main id="main" tabIndex={-1} className="focus:outline-none">
            {children}
          </main>
          <SiteFooter status={status} />
          <LiveAnnouncer />
          <RouteMemory />
        </Providers>
      </body>
    </html>
  );
}
