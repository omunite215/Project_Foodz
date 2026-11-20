import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getActor } from '@/server/auth/session';
import { getTwoFactorChallenge } from '@/server/modules/auth/service';
import { AuthShell } from '@/components/auth/auth-shell';
import { TwoFactorForm, TwoFactorTimedOut } from '@/components/auth/two-factor-form';
import { returnRoute } from '@/lib/auth-links';
import { safeRedirectPath } from '@/lib/redirect';
import { firstParam } from '@/lib/search-params';

export const metadata: Metadata = { title: 'Enter your code' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The code step (S2.9). Rendered only while a sign-in is waiting for its code; otherwise the
 * time-out state. No account data appears here.
 */
export default async function TwoFactorPage({ searchParams }: { searchParams: SearchParams }) {
  const callbackUrl = safeRedirectPath(firstParam((await searchParams).callbackUrl));
  if ((await getActor()).kind === 'user') redirect(returnRoute(callbackUrl));

  const challenge = await getTwoFactorChallenge();
  return (
    <AuthShell>
      {challenge.valid ? (
        <TwoFactorForm callbackUrl={callbackUrl} canTrustDevice={challenge.canTrustDevice} />
      ) : (
        <TwoFactorTimedOut callbackUrl={callbackUrl} />
      )}
    </AuthShell>
  );
}
