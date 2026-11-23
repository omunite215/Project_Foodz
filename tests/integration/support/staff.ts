import { createOTP } from '@better-auth/utils/otp';
import { symmetricEncrypt } from 'better-auth/crypto';
import { v7 as uuid } from 'uuid';
import { expect } from 'vitest';
import type { Role } from '@/server/auth/roles';
import type { UserActor } from '@/server/auth/session';
import type { PrismaClient } from '@/server/db/generated/client';
import { type Browser, newBrowser, switchBrowser } from './browser';
import { PASSWORD } from './checkout';

/*
 * Staff for the F5 suites: a signed-in browser for each account, made the way the seed makes
 * the sample staff (role, flags and two-factor set by the table owner). Test files declare their
 * own mocks (next/headers, the job client, realtime, Turnstile, breached passwords).
 */

export const TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
export const BACKUP_CODES = ['ABCDE-12345', 'FGHIJ-67890', 'KLMNO-13579'];

export interface StaffMember {
  browser: Browser;
  userId: string;
  email: string;
  name: string;
  actor: UserActor;
  /** The member's authenticator, when two-factor is on. */
  code: () => Promise<string>;
}

export interface StaffOptions {
  name?: string;
  twoFactor?: boolean;
  /** The shared demo login (read-only). */
  demo?: boolean;
  /** Seeded sample data, shown in full to the demo admin. */
  sample?: boolean;
}

/** A signed-in account with this role, on its own browser. */
export async function staffMember(
  migrator: PrismaClient,
  role: Role,
  options: StaffOptions = {},
): Promise<StaffMember> {
  const auth = await import('@/server/auth');
  const authActions = await import('@/server/modules/auth/actions');
  const browser = switchBrowser(newBrowser());
  const email = `${role}-${uuid()}@example.com`;
  const name = options.name ?? `${role[0]?.toUpperCase()}${role.slice(1)} Staff`;
  const result = await authActions.signUpAction({
    name,
    email,
    password: PASSWORD,
    captchaToken: 'ok',
  });
  expect(result?.data?.signedIn).toBe(true);
  const twoFactor =
    options.twoFactor ?? (role !== 'customer' && role !== 'partner' && !options.demo);
  const { id: userId } = await migrator.user.update({
    where: { email },
    data: {
      role,
      emailVerified: true,
      isDemo: options.demo ?? false,
      isSample: options.sample ?? false,
      twoFactorEnabled: twoFactor,
    },
    select: { id: true },
  });
  if (twoFactor) {
    const context = await auth.auth.$context;
    await migrator.twoFactor.create({
      data: {
        id: uuid(),
        userId,
        secret: await symmetricEncrypt({ key: context.secretConfig, data: TOTP_SECRET }),
        backupCodes: await symmetricEncrypt({
          key: context.secretConfig,
          data: JSON.stringify(BACKUP_CODES),
        }),
        verified: true,
      },
    });
  }
  return {
    browser,
    userId,
    email,
    name,
    actor: { kind: 'user', userId, role, isDemo: options.demo ?? false },
    code: () => createOTP(TOTP_SECRET, { digits: 6 }).totp(),
  };
}

/** Moves this account's sessions' start back, as if it signed in `minutes` ago. */
export const signedInAgo = (migrator: PrismaClient, userId: string, minutes: number) =>
  migrator.session.updateMany({
    where: { userId },
    data: { createdAt: new Date(Date.now() - minutes * 60_000) },
  });
