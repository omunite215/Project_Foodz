import { cookies, headers } from 'next/headers';
import type { ReactNode } from 'react';
import { isRole, isStaff } from '@/server/auth/roles';
import { getActor } from '@/server/auth/session';
import { partnerMenuEntry } from '@/server/modules/partners/service';
import { readNotices } from '@/server/modules/account/notices';
import { isOrderPage, REQUEST_PATH_HEADER } from '@/lib/request-path';
import { firstNameOf } from '@/server/modules/account/schema';
import { FavoritesProvider } from '@/components/favorites/favorites-provider';
import { OrderNoticeStack } from '@/components/orders/order-notices';
import { initialOf } from '@/lib/account-text';
import {
  loadAnnouncement,
  loadFavoriteIds,
  loadSignedIn,
  loadStoreStatus,
  readOrNull,
  storePhone,
} from '@/lib/storefront-data';
import type { HeaderAccount } from './account-entry';
import { ANNOUNCEMENT_COOKIE } from './announcement';
import { AnnouncementBar } from './announcement-bar';
import { NoticeArea } from './notice-area';
import { SiteFooter } from './site-footer';
import { SiteHeader } from './site-header';
import { SkipLink } from './skip-link';

/**
 * The storefront's frame around a page: the skip link, the announcement bar, the header, the
 * notices, the footer and the hearts' first state. Every storefront route renders inside it
 * (app/(storefront)/layout.tsx), and so does the site's 404, which customers also reach from
 * staff addresses (F5 A1.3). Staff tools under /admin have their own shell and never this one.
 */
export async function StorefrontChrome({ children }: { children: ReactNode }) {
  const [status, announcement, cookieStore, session, notices, requestHeaders] = await Promise.all([
    loadStoreStatus(),
    loadAnnouncement(),
    cookies(),
    loadSignedIn(),
    readNotices(),
    headers(),
  ]);
  const [favoriteIds, partner] = session
    ? await Promise.all([
        loadFavoriteIds(),
        readOrNull('partner menu', async () => partnerMenuEntry(await getActor())),
      ])
    : [null, null];
  // F8 (lead decision 1): never on an order's page, so the delivery code fits above the fold
  // on a phone. Decided here, in the server's HTML, so it never flashes.
  const onOrderPage = isOrderPage(requestHeaders.get(REQUEST_PATH_HEADER));
  const showAnnouncement =
    announcement !== null &&
    !onOrderPage &&
    cookieStore.get(ANNOUNCEMENT_COOKIE)?.value !== announcement.id;

  const user = session?.user;
  const account: HeaderAccount | null = user
    ? {
        firstName: firstNameOf(user.name) || user.name,
        initial: initialOf(user.name),
        fullName: user.name,
        email: user.email,
        isDemo: Boolean(user.isDemo),
        // F5 A1.8: "Staff tools" in the account menu, for staff only.
        staffTools: isRole(user.role) && isStaff(user.role),
        // F6 P6.7: "Partner application" or "Partner app", after "Orders".
        partner,
      }
    : null;
  const emailVerified = Boolean(user && (user.emailVerified || user.isDemo));
  const welcome =
    user && notices.welcome && !emailVerified
      ? { firstName: firstNameOf(user.name) || user.name, email: user.email }
      : null;

  return (
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
      {/* F5 S6.4: order notices, last in the page so keyboard users reach them at its end. */}
      {/* Keyed by the person: a different sign-in never inherits the last one's notices. */}
      {user ? <OrderNoticeStack key={user.id} userId={user.id} /> : null}
    </FavoritesProvider>
  );
}
