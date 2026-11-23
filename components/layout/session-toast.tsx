'use client';

import { showStatusToast, StatusToast } from './status-toast';

/*
 * A message about this device's session that the person must read ("You were signed out on this
 * device, so we emptied your cart."). It uses the shared status toast (F3 design 1.4): it floats
 * over the page, is announced once, and stays until dismissed.
 */

export const SIGNED_OUT_ELSEWHERE_TEXT =
  'You were signed out on this device, so we emptied your cart.';
export const SIGN_OUT_OFFLINE_TEXT =
  "You're offline. Try signing out again when you're back online.";
export const SIGN_OUT_FAILED_TEXT = "We couldn't sign you out. Please try again.";

export function showSessionToast(text: string): void {
  showStatusToast({ variant: 'info', text });
}

/** The one status toast of the page; mounted once, by the session watch. */
export const SessionToast = StatusToast;
