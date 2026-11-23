import type { Metadata } from 'next';
import { AccountSignOutButton } from '@/components/account/account-nav';
import { EmailCard } from '@/components/account/email-card';
import { ProfileForm } from '@/components/account/profile-form';
import { AccountPageHead } from '@/components/account/settings-card';
import { phoneCountries } from '@/lib/phone-countries';
import { firstParam } from '@/lib/search-params';

export const metadata: Metadata = { title: 'Your account' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Email and profile (S3.3, S5.1 to S5.3). `?resend=1` (after signing in from an expired link)
 * focuses "Resend link"; nothing is sent until it is pressed.
 */
export default async function AccountPage({ searchParams }: { searchParams: SearchParams }) {
  const resend = firstParam((await searchParams).resend) === '1';
  return (
    <>
      <AccountPageHead title="Your account" />
      <div className="mt-8 space-y-6">
        <EmailCard resendRequested={resend} />
        <ProfileForm countries={phoneCountries()} />
      </div>
      <AccountSignOutButton />
    </>
  );
}
