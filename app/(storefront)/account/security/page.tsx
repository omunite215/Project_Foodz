import type { Metadata } from 'next';
import { getActor, getSession } from '@/server/auth/session';
import { logger } from '@/server/logger';
import type { DeviceDto } from '@/server/modules/account/schema';
import { listDevices } from '@/server/modules/account/service';
import { DevicesCard } from '@/components/account/devices-card';
import { PasswordCard } from '@/components/account/password-card';
import { AccountPageHead } from '@/components/account/settings-card';
import { TwoFactorCard } from '@/components/account/two-factor-card';
import { loadStoreStatus } from '@/lib/storefront-data';

export const metadata: Metadata = { title: 'Security' };

async function loadDevices(): Promise<DeviceDto[] | null> {
  const [actor, session] = await Promise.all([getActor(), getSession()]);
  if (actor.kind !== 'user' || !session) return [];
  try {
    return await listDevices(actor, {
      id: session.session.id,
      createdAt: new Date(session.session.createdAt),
    });
  } catch (error) {
    logger.error({ err: error }, 'devices unavailable');
    return null;
  }
}

/** Password, two-factor status and signed-in devices (S5.4 to S5.7). */
export default async function SecurityPage() {
  const [devices, status] = await Promise.all([loadDevices(), loadStoreStatus()]);

  return (
    <>
      <AccountPageHead title="Security" />
      <div className="mt-8 space-y-6">
        <PasswordCard />
        <TwoFactorCard />
        <DevicesCard
          devices={devices}
          now={new Date().toISOString()}
          timeZone={status?.timeZone ?? 'America/New_York'}
        />
      </div>
    </>
  );
}
