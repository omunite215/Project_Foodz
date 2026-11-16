'use server';

import { headers } from 'next/headers';
import { publicAction, userAction } from '@/server/action';
import { auth } from '@/server/auth';
import { getSession } from '@/server/auth/session';
import { unauthenticated } from '@/server/errors';
import { dismissNotice, setFlashNotice } from './notices';
import {
  deleteAccountInput,
  deviceIdInput,
  dismissNoticeInput,
  updateProfileInput,
} from './schema';
import {
  type CurrentSession,
  deleteAccount,
  exportMyData,
  getMyAccount,
  listDevices,
  signOutDevice,
  signOutOtherDevices,
  updateProfile,
} from './service';

/** The session behind this request; the device the caller is using. */
async function currentSession(): Promise<CurrentSession> {
  const session = await getSession();
  if (!session) throw unauthenticated();
  return { id: session.session.id, createdAt: new Date(session.session.createdAt) };
}

export const getAccountAction = userAction
  .metadata({ name: 'account.get' })
  .action(async ({ ctx }) => getMyAccount(ctx.actor));

export const updateProfileAction = userAction
  .metadata({ name: 'account.updateProfile', rateLimit: 'account.update', write: true })
  .inputSchema(updateProfileInput)
  .action(async ({ parsedInput, ctx }) => updateProfile(ctx.actor, parsedInput));

export const listDevicesAction = userAction
  .metadata({ name: 'account.listDevices', rateLimit: 'account.devices' })
  .action(async ({ ctx }) => listDevices(ctx.actor, await currentSession()));

export const signOutDeviceAction = userAction
  .metadata({ name: 'account.signOutDevice', rateLimit: 'account.devices', write: true })
  .inputSchema(deviceIdInput)
  .action(async ({ parsedInput, ctx }) =>
    signOutDevice(ctx.actor, parsedInput, await currentSession()),
  );

export const signOutOtherDevicesAction = userAction
  .metadata({ name: 'account.signOutOtherDevices', rateLimit: 'account.devices', write: true })
  .action(async ({ ctx }) => signOutOtherDevices(ctx.actor, await currentSession()));

/** Demo accounts may export: they get the seeded data and only this device (S5.13). */
export const exportMyDataAction = userAction
  .metadata({ name: 'account.export', rateLimit: 'account.export' })
  .action(async ({ ctx }) => exportMyData(ctx.actor, await currentSession()));

export const deleteAccountAction = userAction
  .metadata({ name: 'account.delete', rateLimit: 'account.delete', write: true })
  .inputSchema(deleteAccountInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await deleteAccount(ctx.actor, parsedInput, await currentSession());
    // The sessions are gone; this clears the cookies on this device.
    await auth.api.signOut({ headers: await headers() });
    await setFlashNotice('account-deleted');
    return result;
  });

/** Dismisses a notice in the layout. Works signed out (flash notices). */
export const dismissNoticeAction = publicAction
  .metadata({ name: 'account.dismissNotice' })
  .inputSchema(dismissNoticeInput)
  .action(async ({ parsedInput }) => {
    await dismissNotice(parsedInput.notice);
    return { dismissed: parsedInput.notice };
  });
