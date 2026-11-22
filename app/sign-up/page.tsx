import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getActor } from '@/server/auth/session';
import { getAuthOptions } from '@/server/modules/account/service';
import { AuthShell } from '@/components/auth/auth-shell';
import { SignUpForm } from '@/components/auth/sign-up-form';
import { returnRoute } from '@/lib/auth-links';
import { safeRedirectPath } from '@/lib/redirect';
import { firstParam } from '@/lib/search-params';

export const metadata: Metadata = { title: 'Create an account' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Create an account (S1). Someone already signed in goes straight on (S2.7). */
export default async function SignUpPage({ searchParams }: { searchParams: SearchParams }) {
  const callbackUrl = safeRedirectPath(firstParam((await searchParams).callbackUrl));
  if ((await getActor()).kind === 'user') redirect(returnRoute(callbackUrl));

  return (
    <AuthShell>
      <SignUpForm callbackUrl={callbackUrl} google={getAuthOptions().google} />
    </AuthShell>
  );
}
