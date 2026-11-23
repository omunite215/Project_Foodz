import { useSyncExternalStore } from 'react';
import { z } from 'zod';
import { latitudeSchema, longitudeSchema } from '@/server/modules/addresses/schema';

/*
 * An address checked in the cart without saving it (F3 U2, D18): kept in this tab only, and
 * forgotten when the session that used it ends (F3 security S2).
 */

export interface CheckedAddress {
  line1: string;
  lat: number;
  lng: number;
  /** From the pick, so checkout can offer to save it as it was found (F4 S2.5). */
  city?: string;
  hasHouseNumber?: boolean;
}

const CHECKED_KEY = 'foodz.cart.point';
const checkedSchema = z.object({
  line1: z.string().min(1).max(200),
  lat: latitudeSchema,
  lng: longitudeSchema,
  city: z.string().min(1).max(120).optional(),
  hasHouseNumber: z.boolean().optional(),
});
const checkedListeners = new Set<() => void>();
let checkedCache: { raw: string | null; value: CheckedAddress | null } = { raw: null, value: null };

function readChecked(): CheckedAddress | null {
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(CHECKED_KEY);
  } catch {
    return null;
  }
  if (raw === checkedCache.raw) return checkedCache.value;
  let value: CheckedAddress | null = null;
  try {
    const parsed = checkedSchema.safeParse(raw ? JSON.parse(raw) : null);
    value = parsed.success ? parsed.data : null;
  } catch {
    value = null;
  }
  checkedCache = { raw, value };
  return value;
}

export function setCheckedAddress(value: CheckedAddress | null) {
  try {
    if (value) window.sessionStorage.setItem(CHECKED_KEY, JSON.stringify(value));
    else window.sessionStorage.removeItem(CHECKED_KEY);
  } catch {
    // Storage blocked: the check holds until the page is left.
  }
  for (const listener of checkedListeners) listener();
}

export function useCheckedAddress(): CheckedAddress | null {
  return useSyncExternalStore(
    (listener) => {
      checkedListeners.add(listener);
      return () => {
        checkedListeners.delete(listener);
      };
    },
    readChecked,
    () => null,
  );
}
