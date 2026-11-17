import type { Metadata } from 'next';
import { DeleteAccountCard, DownloadDataCard } from '@/components/account/privacy-cards';
import { AccountPageHead } from '@/components/account/settings-card';

export const metadata: Metadata = { title: 'Privacy and data' };

/** Download a copy of the data, or delete the account (S6.1 to S6.4). */
export default function PrivacyPage() {
  return (
    <>
      <AccountPageHead title="Privacy and data" />
      <div className="mt-8 space-y-6">
        <DownloadDataCard />
        <DeleteAccountCard />
      </div>
    </>
  );
}
