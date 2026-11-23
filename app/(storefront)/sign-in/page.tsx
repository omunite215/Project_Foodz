import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { isStaff } from '@/server/auth/roles';
import { getActor } from '@/server/auth/session';
import { getAuthOptions } from '@/server/modules/account/service';
import { signInReason } from '@/server/modules/auth/schema';
import { AuthShell } from '@/components/auth/auth-shell';
import { SignInForm } from '@/components/auth/sign-in-form';
import { returnRoute } from '@/lib/auth-links';
import { safeRedirectPath, signInLanding } from '@/lib/redirect';
import { firstParam } from '@/lib/search-params';

export const metadata: Metadata = { title: 'Sign in' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const NOTICES = ['password-changed', 'session-ended'] as const;
type Notice = (typeof NOTICES)[number];
const isNotice = (value: unknown): value is Notice =>
  typeof value === 'string' && (NOTICES as readonly string[]).includes(value);

/** Sign in (S2). Someone already signed in goes straight on to where they were heading (S2.7). */
export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const callbackUrl = safeRedirectPath(firstParam(params.callbackUrl));
  const actor = await getActor();
  if (actor.kind === 'user') {
    redirect(returnRoute(signInLanding(callbackUrl, isStaff(actor.role))));
  }

  const notice = firstParam(params.notice);
  return (
    <AuthShell>
      <SignInForm
        callbackUrl={callbackUrl}
        reason={signInReason(firstParam(params.reason))}
        notice={isNotice(notice) ? notice : null}
        googleError={firstParam(params.error) ?? null}
        google={getAuthOptions().google}
      />
    </AuthShell>
  );
}
