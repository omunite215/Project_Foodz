'use server';

import { headers } from 'next/headers';
import { publicAction, userAction } from '@/server/action';
import {
  changeEmailInput,
  changePasswordInput,
  requestPasswordResetInput,
  resendVerificationInput,
  resetPasswordInput,
  signInInput,
  signUpInput,
  twoFactorInput,
} from './schema';
import {
  changeEmail,
  changePassword,
  type FlowRequest,
  requestPasswordReset,
  resendVerification,
  resetPassword,
  signIn,
  signOut,
  signUp,
  verifyTwoFactor,
} from './service';

/*
 * Sign-in and account-security forms. Each action is also a plain form action, so the forms
 * work before the page's scripts load. The per-IP limit in `metadata` is a coarse cap; the
 * services apply the specific limits (failed sign-ins, accepted sign-ups, and so on).
 */

const flowRequest = async (ip: string): Promise<FlowRequest> => ({
  ip,
  headers: new Headers(await headers()),
});

export const signInAction = publicAction
  .metadata({ name: 'auth.signIn', rateLimit: 'auth.default' })
  .inputSchema(signInInput)
  .action(async ({ parsedInput, ctx }) => signIn(parsedInput, await flowRequest(ctx.request.ip)));

export const verifyTwoFactorAction = publicAction
  .metadata({ name: 'auth.verifyTwoFactor', rateLimit: 'auth.default' })
  .inputSchema(twoFactorInput)
  .action(async ({ parsedInput, ctx }) =>
    verifyTwoFactor(parsedInput, await flowRequest(ctx.request.ip)),
  );

export const signUpAction = publicAction
  .metadata({ name: 'auth.signUp', rateLimit: 'auth.sign-up.any' })
  .inputSchema(signUpInput)
  .action(async ({ parsedInput, ctx }) => signUp(parsedInput, await flowRequest(ctx.request.ip)));

export const requestPasswordResetAction = publicAction
  .metadata({ name: 'auth.requestPasswordReset', rateLimit: 'auth.default' })
  .inputSchema(requestPasswordResetInput)
  .action(async ({ parsedInput, ctx }) =>
    requestPasswordReset(parsedInput, await flowRequest(ctx.request.ip)),
  );

export const resetPasswordAction = publicAction
  .metadata({ name: 'auth.resetPassword', rateLimit: 'auth.default' })
  .inputSchema(resetPasswordInput)
  .action(async ({ parsedInput, ctx }) =>
    resetPassword(parsedInput, await flowRequest(ctx.request.ip)),
  );

export const signOutAction = publicAction
  .metadata({ name: 'auth.signOut', rateLimit: 'auth.default' })
  .action(async ({ ctx }) => signOut(await flowRequest(ctx.request.ip)));

export const resendVerificationAction = userAction
  .metadata({ name: 'auth.resendVerification', rateLimit: 'auth.default' })
  .inputSchema(resendVerificationInput)
  .action(async ({ parsedInput, ctx }) =>
    resendVerification(ctx.actor, parsedInput, await flowRequest(ctx.request.ip)),
  );

export const changeEmailAction = userAction
  .metadata({ name: 'auth.changeEmail', rateLimit: 'auth.default', write: true })
  .inputSchema(changeEmailInput)
  .action(async ({ parsedInput, ctx }) =>
    changeEmail(ctx.actor, parsedInput, await flowRequest(ctx.request.ip)),
  );

export const changePasswordAction = userAction
  .metadata({ name: 'auth.changePassword', rateLimit: 'auth.default', write: true })
  .inputSchema(changePasswordInput)
  .action(async ({ parsedInput, ctx }) =>
    changePassword(ctx.actor, parsedInput, await flowRequest(ctx.request.ip)),
  );
