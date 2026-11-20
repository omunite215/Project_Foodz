import { z } from 'zod';
import { hasControlCharacters } from '@/lib/text';

export const ADDRESS_LIMIT = 10;
export const ADDRESS_KINDS = ['HOME', 'WORK', 'OTHER'] as const;
export type AddressKind = (typeof ADDRESS_KINDS)[number];

export const KIND_LABELS: Record<Exclude<AddressKind, 'OTHER'>, string> = {
  HOME: 'Home',
  WORK: 'Work',
};

// Printable text only: no control characters (tabs and line breaks included).
const printable = (value: string) => !hasControlCharacters(value);

const text = (min: number, max: number, messages: { min?: string; max: string }) =>
  z
    .string()
    .trim()
    .min(min, messages.min ?? 'This field is required.')
    .max(max, messages.max)
    .refine(printable, 'Use letters, numbers and punctuation only.');

/** Optional text: '' and missing both mean "none". */
const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .refine(printable, 'Use letters, numbers and punctuation only.')
    .optional()
    .transform((value) => (value ? value : undefined));

export const latitudeSchema = z.number().finite().min(-90).max(90);
export const longitudeSchema = z.number().finite().min(-180).max(180);

const addressFields = z
  .object({
    kind: z.enum(ADDRESS_KINDS),
    /** Required for OTHER; ignored for HOME and WORK. */
    label: optionalText(30, 'Use 30 characters or fewer.'),
    line1: text(3, 200, {
      min: 'Choose an address from the suggestions.',
      max: 'Use 200 characters or fewer.',
    }),
    line2: optionalText(100, 'Use 100 characters or fewer.'),
    city: text(2, 120, {
      min: 'Choose an address from the suggestions.',
      max: 'Use 120 characters or fewer.',
    }),
    notes: optionalText(200, 'Use 200 characters or fewer.'),
    lat: latitudeSchema,
    lng: longitudeSchema,
    isDefault: z.boolean().default(false),
  })
  .strict();

const otherNeedsLabel = (value: { kind: AddressKind; label?: string }, ctx: z.RefinementCtx) => {
  if (value.kind === 'OTHER' && !value.label) {
    ctx.addIssue({ code: 'custom', path: ['label'], message: 'Give this place a name.' });
  }
};

export const createAddressInput = addressFields.superRefine(otherNeedsLabel);
export const updateAddressInput = addressFields
  .extend({ id: z.uuid() })
  .superRefine(otherNeedsLabel);
export const addressIdInput = z.object({ id: z.uuid() }).strict();
export const addressSearchInput = z
  .object({
    query: text(3, 200, {
      min: 'Type at least 3 characters.',
      max: 'Use 200 characters or fewer.',
    }),
  })
  .strict();
export const deliveryCheckInput = z
  .object({
    lat: latitudeSchema,
    lng: longitudeSchema,
    line1: optionalText(200, 'Use 200 characters or fewer.'),
  })
  .strict();

export type CreateAddressInput = z.input<typeof createAddressInput>;
export type UpdateAddressInput = z.input<typeof updateAddressInput>;
export type AddressFields = z.output<typeof createAddressInput>;

// ------------------------------------------------------------------ DTOs

export const addressDtoSchema = z.object({
  id: z.uuid(),
  kind: z.enum(ADDRESS_KINDS),
  label: z.string(),
  line1: z.string(),
  line2: z.string().nullable(),
  city: z.string(),
  notes: z.string().nullable(),
  lat: z.number(),
  lng: z.number(),
  isDefault: z.boolean(),
  createdAt: z.iso.datetime(),
  /** Inside the delivery radius right now (S4.13). */
  deliverable: z.boolean(),
  /** Straight-line distance from the kitchen, one decimal. */
  distanceKm: z.number(),
});
export type AddressDto = z.infer<typeof addressDtoSchema>;

export interface StoreArea {
  addressText: string;
  /** "88 Harbor Street": the first part of the store address. */
  street: string;
  radiusKm: number;
}

export interface AddressBook {
  addresses: AddressDto[];
  limit: typeof ADDRESS_LIMIT;
  canAdd: boolean;
  /** False for the shared demo accounts (U2). */
  canEdit: boolean;
  store: StoreArea;
}

export interface AddressSuggestion {
  id: string;
  line1: string;
  city: string;
  placeName: string | null;
  hasHouseNumber: boolean;
  lat: number;
  lng: number;
}

export interface DeliveryCheck {
  deliverable: boolean;
  distanceKm: number;
  radiusKm: number;
  storeAddress: string;
  storeStreet: string;
  message: string;
}

export interface DeleteAddressResult {
  deletedId: string;
  newDefault: { id: string; label: string } | null;
}

/** A row from the staff view; personal fields are masked for demo staff (U4). */
export interface StaffAddressView {
  id: string;
  userId: string;
  kind: AddressKind;
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  notes: string | null;
  lat: number;
  lng: number;
  isDefault: boolean;
  createdAt: string;
  masked: boolean;
}

// ------------------------------------------------------------------ copy

const km = (value: number) => value.toFixed(1);

/** The S4.6 sentence for a delivery check. */
export function deliveryMessage(check: {
  deliverable: boolean;
  distanceKm: number;
  radiusKm: number;
  storeStreet: string;
  line1?: string;
}) {
  if (check.deliverable) {
    return `We deliver here · about ${km(check.distanceKm)} km from our kitchen`;
  }
  const place = check.line1 ?? 'this address';
  const radius = Number.isInteger(check.radiusKm) ? String(check.radiusKm) : km(check.radiusKm);
  return `Sorry, we don't deliver to ${place} yet. It's about ${km(check.distanceKm)} km from our kitchen at ${check.storeStreet}, and we deliver within ${radius} km.`;
}

export const labelFor = (kind: AddressKind, label: string | undefined) =>
  kind === 'OTHER' ? (label ?? 'Other') : KIND_LABELS[kind];
