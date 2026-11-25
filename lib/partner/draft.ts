import { z } from 'zod';

/*
 * The unsent application, kept on this phone (F6 design 4.2, D12): a form that survives a
 * reload, a dropped signal or a closed tab. It lives in localStorage under the account's id and
 * is kept 24 hours, as long as the server keeps unsent uploads. It never holds the ID number, an
 * image or the agreements (P4.9). One account's draft is never given to another. Storage may be
 * blocked or full; then there is simply no draft.
 */

const PREFIX = 'foodz.partner-apply:';
export const APPLY_DRAFT_LIFETIME_MS = 24 * 60 * 60 * 1000;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

const localStore = (): Store | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

/** What a draft may hold: everything but the number, the images and the ticks. */
export const applyDraftSchema = z
  .object({
    step: z.number().int().min(1).max(4),
    phone: z.string().max(40),
    phoneCountry: z.string().max(8),
    vehicleType: z.enum(['BICYCLE', 'SCOOTER', 'MOTORBIKE', 'CAR']).nullable(),
    plate: z.string().max(12),
    idDocumentType: z.enum(['DRIVER_LICENSE', 'STATE_ID', 'PASSPORT']).nullable(),
    idExpiresOn: z.string().max(10),
    photoUploadId: z.uuid().nullable(),
    idDocumentUploadId: z.uuid().nullable(),
  })
  .strip();
export type ApplyDraft = z.infer<typeof applyDraftSchema>;

interface Saved {
  owner: string;
  savedAt: number;
  values: unknown;
}

const isSaved = (value: unknown): value is Saved =>
  typeof value === 'object' &&
  value !== null &&
  typeof Reflect.get(value, 'owner') === 'string' &&
  typeof Reflect.get(value, 'savedAt') === 'number';

const keyFor = (owner: string) => `${PREFIX}${owner}`;

export function saveApplyDraft(
  owner: string,
  values: ApplyDraft,
  { store = localStore(), now = Date.now() }: { store?: Store | null; now?: number } = {},
): void {
  // Only the listed fields: anything else on `values` (the number) is dropped here.
  const parsed = applyDraftSchema.safeParse(values);
  if (!parsed.success) return;
  try {
    store?.setItem(keyFor(owner), JSON.stringify({ owner, savedAt: now, values: parsed.data }));
  } catch {
    // Full or blocked.
  }
}

/** The owner's draft from the last 24 hours, or null. An expired or foreign draft is removed. */
export function readApplyDraft(
  owner: string,
  { store = localStore(), now = Date.now() }: { store?: Store | null; now?: number } = {},
): ApplyDraft | null {
  let raw: string | null;
  try {
    raw = store?.getItem(keyFor(owner)) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;
  let saved: unknown;
  try {
    saved = JSON.parse(raw);
  } catch {
    forgetApplyDraft(owner, { store });
    return null;
  }
  const age = isSaved(saved) ? now - saved.savedAt : -1;
  if (!isSaved(saved) || saved.owner !== owner || age < 0 || age > APPLY_DRAFT_LIFETIME_MS) {
    forgetApplyDraft(owner, { store });
    return null;
  }
  const values = applyDraftSchema.safeParse(saved.values);
  return values.success ? values.data : null;
}

export function forgetApplyDraft(
  owner: string,
  { store = localStore() }: { store?: Store | null } = {},
): void {
  try {
    store?.removeItem(keyFor(owner));
  } catch {
    // Blocked.
  }
}

/** Signing out: every account's application draft on this phone goes. */
export function forgetApplyDrafts({ store = localStore() }: { store?: Store | null } = {}): void {
  try {
    if (!store) return;
    const keys: string[] = [];
    for (let index = 0; index < store.length; index++) {
      const key = store.key(index);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) store.removeItem(key);
  } catch {
    // Blocked.
  }
}
