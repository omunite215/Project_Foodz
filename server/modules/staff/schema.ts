import { z } from 'zod';
import { TWO_FACTOR_METHODS } from '@/server/modules/auth/schema';

/*
 * Staff tools shared by every admin screen (F5 first): who may enter `/admin` and what the
 * shell shows, the 12-hour staff session (U11), and the step-up code asked before giving money
 * back (U4, A7.10). F10 and F11 reuse the step-up for refunds, bans and role changes.
 */

/** U11: staff sessions last this long from sign-in and are never extended by activity. */
export const STAFF_SESSION_MS = 12 * 60 * 60 * 1000;
/** A1.7: the "Your session ends at …" banner shows this long before the end. */
export const SESSION_WARNING_MS = 15 * 60 * 1000;
/** A7.10: a sign-in or a code check covers money-back actions for this long. */
export const STEP_UP_WINDOW_MS = 10 * 60 * 1000;

export const STEP_UP_ERRORS = {
  totp: "That code didn't work. Check your app and try again.",
  backup: "That backup code didn't work. Each code works once.",
  totpFormat: 'Enter the 6 digits from your app.',
  backupFormat: 'Enter one of your backup codes.',
} as const;

/** The step-up dialog's code (A7.10): the same rules as the sign-in code (F2 S2.9). */
export const stepUpInput = z
  .object({ method: z.enum(TWO_FACTOR_METHODS), code: z.string().max(64) })
  .strict()
  .transform((value) => ({
    ...value,
    // "123 456" and "123-456" are accepted.
    code: value.method === 'totp' ? value.code.replace(/[\s-]/g, '') : value.code.trim(),
  }))
  .superRefine((value, ctx) => {
    if (value.method === 'totp' && !/^\d{6}$/.test(value.code)) {
      ctx.addIssue({ code: 'custom', path: ['code'], message: STEP_UP_ERRORS.totpFormat });
    }
    if (value.method === 'backup' && !/^[A-Za-z0-9-]{4,32}$/.test(value.code)) {
      ctx.addIssue({ code: 'custom', path: ['code'], message: STEP_UP_ERRORS.backupFormat });
    }
  });
export type StepUpInput = z.input<typeof stepUpInput>;

export type StaffRole = 'kitchen' | 'support' | 'content_editor' | 'admin';

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  kitchen: 'Kitchen',
  support: 'Support',
  content_editor: 'Content editor',
  admin: 'Admin',
};

/**
 * Screens that exist in this build; the sidebar lists only these (U9). F6 adds `partners` for
 * SUPPORT, ADMIN and the demo admin (A18.1); its badge comes from `partnerBadgeAction`.
 */
export type StaffScreen = 'orderBoard' | 'partners';

export interface StaffUser {
  name: string;
  role: StaffRole;
  isDemo: boolean;
}

/**
 * What the `/admin` layout renders (A1, design 1.1). Decided on the server for every page and
 * checked again in every action; the browser never renders the shell first.
 */
export type StaffShell =
  /** Redirect to `/sign-in?callbackUrl=<address>` before anything renders (A1.2). */
  | { kind: 'guest' }
  /** Customers and couriers: the storefront's ordinary 404 (A1.3). */
  | { kind: 'notStaff' }
  /** Staff without two-factor: the gate, with no order data and no realtime (A1.4). */
  | { kind: 'twoFactorRequired'; user: StaffUser }
  | {
      kind: 'staff';
      user: StaffUser;
      /** Empty for CONTENT_EDITOR in F5: "Nothing here yet" (A1.5). */
      screens: StaffScreen[];
      /** Where `/admin` sends this person; null shows "Nothing here yet". */
      home: '/admin/orders' | null;
      /** KITCHEN: top bar only, no sidebar (A1.6, A16.1). */
      sidebar: boolean;
      /** The demo admin (A14). */
      readOnly: boolean;
      /** A1.7: sign-in time plus 12 hours (every staff role, the demo admin included). */
      sessionExpiresAt: string;
      /** When the last sign-in or code check stops covering money-back actions. */
      stepUpFreshUntil: string | null;
    };
