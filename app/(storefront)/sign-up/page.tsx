import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getActor } from '@/server/auth/session';
import { getAuthOptions } from '@/server/modules/account/service';
import { signInReason } from '@/server/modules/auth/schema';
import { AuthShell } from '@/components/auth/auth-shell';
import { SignUpForm } from '@/components/auth/sign-up-form';
import { returnRoute } from '@/lib/auth-links';
import { safeRedirectPath } from '@/lib/redirect';
import { firstParam } from '@/lib/search-params';

export const metadata: Metadata = { title: 'Create an account' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Create an account (S1). Someone already signed in goes straight on (S2.7). */
export default async function SignUpPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const callbackUrl = safeRedirectPath(firstParam(params.callbackUrl));
  if ((await getActor()).kind === 'user') redirect(returnRoute(callbackUrl));

  return (
    <AuthShell>
      <SignUpForm
        callbackUrl={callbackUrl}
        reason={signInReason(firstParam(params.reason))}
        google={getAuthOptions().google}
      />
    </AuthShell>
  );
}
