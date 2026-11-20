import { z } from 'zod';
import { DEFAULT_PHONE_COUNTRY, parsePhone } from '@/lib/phone';
import { hasControlCharacters } from '@/lib/text';
import type { Role } from '@/server/auth/roles';
import type { DeviceType } from './devices';

export const NAME_MAX = 60;

/**
 * Invisible format characters (Unicode Cf): bidi overrides and isolates, zero-width spaces, the
 * word joiner. They can make a name read differently from what is stored. The two joiners
 * (U+200C, U+200D) stay allowed: Persian and several Indic scripts need them to spell names.
 */
const FORMAT_CHARACTER = /(?![\u200C\u200D])\p{Cf}/u;

/** 1–60 characters in any script; surrounding spaces dropped, inner runs collapsed (S5.3). */
export const nameSchema = z
  .string()
  .max(500, 'Use 60 characters or fewer.')
  .transform((value) => value.normalize('NFC').replace(/\s+/g, ' ').trim())
  .pipe(
    z
      .string()
      .min(1, 'Enter your name.')
      .max(NAME_MAX, 'Use 60 characters or fewer.')
      .refine(
        (value) => !hasControlCharacters(value) && !FORMAT_CHARACTER.test(value),
        'Use letters, numbers and punctuation only.',
      ),
  );

export const PHONE_ERROR = 'Enter a number we can call, like (617) 555-0142.';

export const updateProfileInput = z
  .object({
    name: nameSchema,
    /** Optional; an empty string removes the number. */
    phone: z.string().trim().max(40, PHONE_ERROR).optional(),
    phoneCountry: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .default(DEFAULT_PHONE_COUNTRY),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.phone && !parsePhone(value.phone, value.phoneCountry)) {
      ctx.addIssue({ code: 'custom', path: ['phone'], message: PHONE_ERROR });
    }
  });
export type UpdateProfileInput = z.input<typeof updateProfileInput>;

export const deviceIdInput = z.object({ id: z.uuid() }).strict();

export const deleteAccountInput = z
  .object({ password: z.string().min(1).max(128).optional() })
  .strict();

export const NOTICES = ['welcome', 'flash', 'demo'] as const;
export const dismissNoticeInput = z.object({ notice: z.enum(NOTICES) }).strict();

// ------------------------------------------------------------------ DTOs

export type SignInMethod = 'password' | 'google';

export interface AccountDto {
  id: string;
  name: string;
  firstName: string;
  email: string;
  emailVerified: boolean;
  /** E.164, e.g. "+16175550142". */
  phone: string | null;
  phoneCountry: string | null;
  /** "(617) 555-0142". */
  phoneDisplay: string | null;
  role: Role;
  isDemo: boolean;
  isStaff: boolean;
  twoFactorEnabled: boolean;
  hasPassword: boolean;
  googleLinked: boolean;
  signInMethods: SignInMethod[];
  addressCount: number;
  /** Saved favorite dishes (F3), for the account menu and side nav. */
  favoriteCount: number;
  /** Orders in the Orders list (failed attempts left out), for its skeleton (F4). */
  orderCount: number;
  /** Cards saved at Stripe, for the Saved cards skeleton (F4); 0 when unknown. */
  savedCardCount: number;
  /** Signed-in devices; 1 for the shared demo accounts, which see only this device. */
  deviceCount: number;
  createdAt: string;
  termsAcceptedVersion: number | null;
  canEditProfile: boolean;
  canDelete: boolean;
  deleteBlockedReason: 'demo' | 'staff' | null;
}

export interface DeviceDto {
  /** The session id (never the session token). */
  id: string;
  label: string;
  browser: string | null;
  system: string | null;
  type: DeviceType;
  isCurrent: boolean;
  signedInAt: string;
  lastActiveAt: string;
}

export interface AccountExport {
  about: { description: string; generatedAt: string; format: 'foodz-data-export'; version: 1 };
  profile: {
    name: string;
    email: string;
    emailConfirmed: boolean;
    phone: string | null;
    joinedAt: string;
    termsVersionAccepted: number | null;
  };
  addresses: {
    type: 'Home' | 'Work' | 'Other';
    label: string;
    address: string;
    apartment: string | null;
    city: string;
    instructions: string | null;
    isDefault: boolean;
    savedAt: string;
  }[];
  devices: { device: string; signedInAt: string; lastActiveAt: string; thisDevice: boolean }[];
  /** Hearted dishes, most recently saved first (F3 S5.11). */
  favorites: { dish: string; savedAt: string }[];
  /** Orders, newest first, with every amount (F4 S12.7). Failed payment attempts are left out. */
  orders: {
    number: string;
    status: string;
    createdAt: string;
    placedAt: string | null;
    deliveredAt: string | null;
    cancelledAt: string | null;
    lines: {
      dish: string;
      quantity: number;
      unitPriceCents: number;
      extras: string[];
      note: string | null;
    }[];
    subtotalCents: number;
    promoCode: string | null;
    discountCents: number;
    deliveryFeeCents: number;
    deliveryDiscountCents: number;
    taxCents: number;
    tipCents: number;
    totalCents: number;
    refundedCents: number;
    paymentMethod: 'card' | 'cash';
    paymentStatus: string;
    /** "Visa •••• 4242". */
    card: string | null;
    deliveredTo: string;
    kitchenNote: string | null;
  }[];
  /** Saved cards: brand, last 4 and expiry only (F4 S6.14). */
  savedCards: { brand: string; last4: string; expires: string }[];
}

/** A person as staff see them; personal fields are masked for demo staff (U4). */
export interface StaffPersonView {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  isDemo: boolean;
  /** Seeded sample data; shown in full to demo logins like demo accounts. */
  isSample: boolean;
  emailVerified: boolean;
  banned: boolean;
  createdAt: string;
  deletedAt: string | null;
  masked: boolean;
}

export const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] ?? '';
