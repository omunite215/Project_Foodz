import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/auth-shell';
import { AuthTitle } from '@/components/auth/auth-title';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';
import { safeRedirectPath } from '@/lib/redirect';
import { firstParam } from '@/lib/search-params';

export const metadata: Metadata = { title: 'Reset your password' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Ask for a reset link (S3.8). The answer is the same for every address. */
export default async function ForgotPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const callbackUrl = safeRedirectPath(firstParam((await searchParams).callbackUrl));
  return (
    <AuthShell>
      <ForgotPasswordForm callbackUrl={callbackUrl}>
        <AuthTitle
          title="Reset your password"
          subtitle="Enter your email and we'll send you a link to choose a new password."
        />
      </ForgotPasswordForm>
    </AuthShell>
  );
}
