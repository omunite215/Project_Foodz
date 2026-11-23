import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getActor } from '@/server/auth/session';
import { AppError } from '@/server/errors';
import { readNotices } from '@/server/modules/account/notices';
import { getMyAccount } from '@/server/modules/account/service';
import { AccountProvider, ReloadFromBackForwardCache } from '@/components/account/account-context';
import { AccountNavBar, AccountSideNav } from '@/components/account/account-nav';
import { DemoNotice } from '@/components/account/demo-notice';
import { PageContainer } from '@/components/layout/page-container';
import { authPageHref, sessionEndedHref } from '@/lib/auth-links';
import { REQUEST_PATH_HEADER } from '@/lib/request-path';

/** Set by the browser on a Server Action request (Next's own `next-action` header). */
const SERVER_ACTION_HEADER = 'next-action';

/**
 * Sends a signed-out visitor to sign in, coming back to the page they asked for (S2.6). Right
 * after deleting the account, Home (with its notice) is the place to be instead.
 *
 * A form sent after the session ended elsewhere lands here too: the action finds the session
 * gone, clears its cookie, and the page is drawn again for the answer. The sign-in page then says
 * why (S2.12), and the form keeps what was typed for the person's return.
 */
async function toSignIn(): Promise<never> {
  if ((await readNotices()).flash === 'account-deleted') redirect('/');
  const requestHeaders = await headers();
  const requested = requestHeaders.get(REQUEST_PATH_HEADER) ?? '/account';
  const back = requested.startsWith('/account') ? requested : '/account';
  redirect(
    requestHeaders.has(SERVER_ACTION_HEADER)
      ? sessionEndedHref(back)
      : authPageHref('/sign-in', back),
  );
}

async function loadAccount() {
  const actor = await getActor();
  if (actor.kind !== 'user') return toSignIn();
  try {
    return await getMyAccount(actor);
  } catch (error) {
    // The session outlived its account (deleted elsewhere).
    if (error instanceof AppError && error.code === 'UNAUTHENTICATED') return toSignIn();
    throw error;
  }
}

/**
 * Every account page: signed-in only, decided on the server before any HTML (S2.6). The account
 * summary is read once here and shared with pages and their skeletons. The demo notice and the
 * navigation live here, so page skeletons render below them and never move them.
 */
export default async function AccountLayout({ children }: { children: ReactNode }) {
  const [account, notices] = await Promise.all([loadAccount(), readNotices()]);

  return (
    <AccountProvider account={account}>
      <ReloadFromBackForwardCache />
      <PageContainer className="pt-8 pb-15 md:pt-15 md:pb-20 xl:pt-20 xl:pb-24">
        {account.isDemo && !notices.demoNoticeDismissed ? <DemoNotice /> : null}
        <div className="lg:grid lg:grid-cols-12 lg:gap-x-6">
          <AccountSideNav />
          <div className="min-w-0 lg:col-span-9 xl:col-span-8">
            <AccountNavBar />
            {children}
          </div>
        </div>
      </PageContainer>
    </AccountProvider>
  );
}
