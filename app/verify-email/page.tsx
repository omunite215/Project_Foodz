import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getActor } from '@/server/auth/session';
import { ResultShell } from '@/components/auth/auth-shell';
import { EmailResult, type EmailResultCase } from '@/components/auth/email-result';
import { authPageHref, returnRoute } from '@/lib/auth-links';
import { safeRedirectPath } from '@/lib/redirect';
import { firstParam } from '@/lib/search-params';

export const metadata: Metadata = { title: 'Confirm your email' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Where a confirm-email link lands (S3.2, S3.5). Confirmed in the browser that is signed in:
 * straight back to where the person was, where the "Email confirmed" notice shows. Any `error`
 * (expired, tampered, sent before an email change, account gone) reads as an expired link.
 */
export default async function VerifyEmailPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const callbackUrl = safeRedirectPath(firstParam(params.callbackUrl));
  const status = firstParam(params.status);
  const via = firstParam(params.via);
  const signedIn = (await getActor()).kind === 'user';

  if (status === 'confirmed' && !via) redirect(returnRoute(callbackUrl));

  let result: EmailResultCase;
  if (status === 'confirmed' && (via === 'new-session' || signedIn)) {
    result = { kind: 'confirmed-new-session' };
  } else if (status === 'confirmed') {
    result = { kind: 'confirmed-signed-out', signInHref: authPageHref('/sign-in', callbackUrl) };
  } else if (status === 'already-confirmed') {
    result = { kind: 'already-confirmed', continueHref: returnRoute(callbackUrl) };
  } else if (signedIn) {
    result = { kind: 'expired-signed-in' };
  } else {
    // After signing in, the account page offers the resend in one tap.
    result = {
      kind: 'expired-signed-out',
      signInHref: authPageHref('/sign-in', '/account?resend=1'),
    };
  }

  return (
    <ResultShell>
      <EmailResult result={result} />
    </ResultShell>
  );
}
