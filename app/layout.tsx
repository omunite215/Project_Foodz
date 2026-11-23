import './globals.css';
import { createHash } from 'node:crypto';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { getSession } from '@/server/auth/session';
import { logger } from '@/server/logger';
import { readNotices } from '@/server/modules/account/notices';
import { firstNameOf } from '@/server/modules/account/schema';
import type { HeaderAccount } from '@/components/layout/account-entry';
import { ANNOUNCEMENT_COOKIE } from '@/components/layout/announcement';
import { AnnouncementBar } from '@/components/layout/announcement-bar';
import { LiveAnnouncer } from '@/components/layout/live-announcer';
import { NoticeArea } from '@/components/layout/notice-area';
import { RouteMemory } from '@/components/layout/route-memory';
import { SessionWatch } from '@/components/layout/session-watch';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { SkipLink } from '@/components/layout/skip-link';
import { Providers } from '@/components/providers';
import { initialOf } from '@/lib/account-text';
import { fontVariables } from '@/lib/fonts';
import { FavoritesProvider } from '@/components/favorites/favorites-provider';
import {
  loadAnnouncement,
  loadFavoriteIds,
  loadStoreStatus,
  storePhone,
} from '@/lib/storefront-data';
import { cn } from '@/lib/utils';

export const metadata: Metadata = {
  title: { default: 'Foodz', template: '%s | Foodz' },
  description: 'Korean, Thai and Vietnamese food, delivered hot.',
};

/**
 * The session as the header needs it, read here on the server and never through the rate-limited
 * /api/auth routes, so a throttled client can never flip the header to "Sign in" (S2.1). If the
 * read fails, the shell still renders (signed out) and the failure is logged.
 */
async function loadSignedIn() {
  try {
    const session = await getSession();
    return session && !session.user.banned ? session : null;
  } catch (error) {
    logger.error({ err: error }, 'session unavailable');
    return null;
  }
}

/** An opaque per-session key for the browser: a hash of the session id, never its token. */
const sessionKeyOf = (sessionId: string) =>
  createHash('sha256').update(sessionId).digest('base64url').slice(0, 22);

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Every page renders per request so its scripts can carry the CSP nonce.
  await connection();

  const [status, announcement, cookieStore, session, notices] = await Promise.all([
    loadStoreStatus(),
    loadAnnouncement(),
    cookies(),
    loadSignedIn(),
    readNotices(),
  ]);
  const favoriteIds = session ? await loadFavoriteIds() : null;
  const showAnnouncement =
    announcement !== null && cookieStore.get(ANNOUNCEMENT_COOKIE)?.value !== announcement.id;

  const user = session?.user;
  const account: HeaderAccount | null = user
    ? {
        firstName: firstNameOf(user.name) || user.name,
        initial: initialOf(user.name),
        fullName: user.name,
        email: user.email,
        isDemo: Boolean(user.isDemo),
      }
    : null;
  const emailVerified = Boolean(user && (user.emailVerified || user.isDemo));
  const welcome =
    user && notices.welcome && !emailVerified
      ? { firstName: firstNameOf(user.name) || user.name, email: user.email }
      : null;

  return (
    <html
      lang="en"
      className={cn(fontVariables, 'motion-safe:scroll-smooth')}
      data-scroll-behavior="smooth"
    >
      <body className="bg-neutral-8 font-poppins text-neutral-2 antialiased">
        <Providers>
          <FavoritesProvider signedIn={account !== null} ids={favoriteIds}>
            <SkipLink />
            {showAnnouncement ? (
              <AnnouncementBar
                campaignId={announcement.id}
                title={announcement.title}
                subtitle={announcement.subtitle}
                code={announcement.coupon?.code ?? null}
              />
            ) : null}
            <SiteHeader account={account} phone={storePhone(status)} />
            <main id="main" tabIndex={-1} className="focus:outline-none">
              <NoticeArea welcome={welcome} flash={notices.flash} emailVerified={emailVerified} />
              {children}
            </main>
            <SiteFooter status={status} />
            <LiveAnnouncer />
            <RouteMemory />
            <SessionWatch
              sessionKey={session ? sessionKeyOf(session.session.id) : null}
              refreshOnReturn={welcome !== null}
            />
          </FavoritesProvider>
        </Providers>
      </body>
    </html>
  );
}
