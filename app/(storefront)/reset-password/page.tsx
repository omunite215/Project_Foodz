import type { Metadata } from 'next';
import { AuthShell, ResultShell } from '@/components/auth/auth-shell';
import { DeadResetLink, ResetPasswordPage } from '@/components/auth/reset-password-page';
import { safeRedirectPath } from '@/lib/redirect';
import { firstParam } from '@/lib/search-params';

export const metadata: Metadata = { title: 'Reset your password' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const TOKEN = /^[\w-]{1,256}$/;

/**
 * The reset link's landing page (S3.9, S3.10). A used, expired, tampered or cut-short link
 * shows "This link no longer works" with the form for a new one.
 */
export default async function ResetPasswordRoute({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const callbackUrl = safeRedirectPath(firstParam(params.callbackUrl));
  const token = firstParam(params.token);

  if (firstParam(params.error) || !token || !TOKEN.test(token)) {
    return (
      <ResultShell>
        <DeadResetLink callbackUrl={callbackUrl} />
      </ResultShell>
    );
  }
  return (
    <AuthShell>
      <ResetPasswordPage token={token} callbackUrl={callbackUrl} />
    </AuthShell>
  );
}
