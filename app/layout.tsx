import './globals.css';
import { createHash } from 'node:crypto';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { readNotices } from '@/server/modules/account/notices';
import { LiveAnnouncer } from '@/components/layout/live-announcer';
import { RouteMemory } from '@/components/layout/route-memory';
import { SessionWatch } from '@/components/layout/session-watch';
import { Providers } from '@/components/providers';
import { fontVariables } from '@/lib/fonts';
import { loadSignedIn } from '@/lib/storefront-data';
import { cn } from '@/lib/utils';

export const metadata: Metadata = {
  title: { default: 'Foodz', template: '%s | Foodz' },
  description: 'Korean, Thai and Vietnamese food, delivered hot.',
};

/** An opaque per-session key for the browser: a hash of the session id, never its token. */
const sessionKeyOf = (sessionId: string) =>
  createHash('sha256').update(sessionId).digest('base64url').slice(0, 22);

/**
 * What every page shares, the storefront and the staff tools alike: fonts, the data clients,
 * the live regions, route memory and the session watch. Each side brings its own frame: the
 * storefront's header and footer (app/(storefront)/layout.tsx) or the staff shell
 * (app/admin/layout.tsx), so /admin never shows the storefront's chrome (F5 design 1.1).
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  // Every page renders per request so its scripts can carry the CSP nonce.
  await connection();

  const [session, notices] = await Promise.all([loadSignedIn(), readNotices()]);
  const user = session?.user;
  const awaitingEmail = Boolean(
    user && notices.welcome && !(user.emailVerified || Boolean(user.isDemo)),
  );

  return (
    <html
      lang="en"
      className={cn(fontVariables, 'motion-safe:scroll-smooth')}
      data-scroll-behavior="smooth"
    >
      <body className="bg-neutral-8 font-poppins text-neutral-2 antialiased">
        <Providers>
          {children}
          <LiveAnnouncer />
          <RouteMemory />
          <SessionWatch
            sessionKey={session ? sessionKeyOf(session.session.id) : null}
            refreshOnReturn={awaitingEmail}
          />
        </Providers>
      </body>
    </html>
  );
}
