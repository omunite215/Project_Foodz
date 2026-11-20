'use client';

import { Check } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useAccount } from './account-context';
import { SettingsCard } from './settings-card';

/** Shown only to accounts with two-factor on; turning it on or off comes later (U3). */
export function TwoFactorCard() {
  const account = useAccount();
  if (!account.twoFactorEnabled) return null;
  return (
    <SettingsCard id="two-factor" title="Two-factor sign-in">
      <p className="flex flex-wrap items-center gap-3">
        <Badge variant="success">
          <Check aria-hidden />
          On
        </Badge>
        <span className="text-body-5 text-neutral-3">
          You enter a code from your authenticator app when you sign in.
        </span>
      </p>
    </SettingsCard>
  );
}
