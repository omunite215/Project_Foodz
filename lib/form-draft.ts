import { useEffect, useId } from 'react';
import type { ZodType } from 'zod';

/*
 * What someone typed into an account form when their session ended (S2.12), kept so it can come
 * back once they sign in again. A draft:
 *   - lives in this tab only (sessionStorage), never in a cookie, the address or on the server;
 *   - belongs to the account it was typed under, and is given back only to that account;
 *   - is kept for 30 minutes at most;
 *   - is deleted once given back or saved, and on signing out.
 * So a different person signing in on the same device never sees it. Password fields are never
 * part of a draft. Storage may be blocked; then the person simply types again.
 */

const PREFIX = 'foodz.draft:';

/** How long a draft waits for its owner to sign in again. */
export const DRAFT_LIFETIME_MS = 30 * 60 * 1000;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

interface Options {
  store?: Store | null;
  now?: number;
}

const sessionStore = (): Store | null => {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
};

interface SavedDraft {
  owner: string;
  savedAt: number;
  values: unknown;
}

const isSavedDraft = (value: unknown): value is SavedDraft =>
  typeof value === 'object' &&
  value !== null &&
  typeof Reflect.get(value, 'owner') === 'string' &&
  typeof Reflect.get(value, 'savedAt') === 'number';

const keyFor = (path: string) => `${PREFIX}${path}`;

/** Keeps what was typed on the form at `path`, for the account `owner`. */
export function saveDraft(
  path: string,
  owner: string,
  values: unknown,
  { store = sessionStore(), now = Date.now() }: Options = {},
): void {
  const draft: SavedDraft = { owner, savedAt: now, values };
  try {
    store?.setItem(keyFor(path), JSON.stringify(draft));
  } catch {
    // Storage full or blocked.
  }
}

/**
 * The draft for the form at `path`, if `owner` typed it in the last 30 minutes. Whatever is found
 * there is deleted, so a draft is given back once at most and never to anyone else.
 */
export function takeDraft<T>(
  path: string,
  owner: string,
  schema: ZodType<T>,
  { store = sessionStore(), now = Date.now() }: Options = {},
): T | null {
  let raw: string | null;
  try {
    raw = store?.getItem(keyFor(path)) ?? null;
    if (raw !== null) store?.removeItem(keyFor(path));
  } catch {
    return null;
  }
  if (!raw) return null;

  let saved: unknown;
  try {
    saved = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isSavedDraft(saved) || saved.owner !== owner) return null;
  const age = now - saved.savedAt;
  if (age < 0 || age > DRAFT_LIFETIME_MS) return null;
  const values = schema.safeParse(saved.values);
  return values.success ? values.data : null;
}

/** The form at `path` was saved: its draft has nothing left to give back. */
export function forgetDraft(path: string, { store = sessionStore() }: Options = {}): void {
  try {
    store?.removeItem(keyFor(path));
  } catch {
    // Storage blocked.
  }
}

/** Signing out on purpose: every draft in this tab goes. */
export function forgetDrafts({ store = sessionStore() }: Options = {}): void {
  try {
    if (!store) return;
    const keys: string[] = [];
    for (let index = 0; index < store.length; index++) {
      const key = store.key(index);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) store.removeItem(key);
  } catch {
    // Storage blocked.
  }
}

/*
 * Forms holding changes that are not saved yet. While there are any, this tab does not re-read
 * the page in the background (after a sign-out in another tab, or on returning to the tab): on
 * an account page that would send the person to sign in and wipe what they typed. The re-read
 * waits until no form holds changes (saved, or left for another page), so the person's next
 * action shows the signed-out state instead (S5.8).
 */
const unsaved = new Set<string>();
const settledListeners = new Set<() => void>();

export function markUnsaved(form: string, dirty: boolean): void {
  const before = unsaved.size;
  if (dirty) unsaved.add(form);
  else unsaved.delete(form);
  if (before > 0 && unsaved.size === 0) {
    for (const listener of settledListeners) listener();
  }
}

export const hasUnsavedChanges = (): boolean => unsaved.size > 0;

/** Calls `listener` each time the last form with unsaved changes lets go of them. */
export function onUnsavedChangesSettled(listener: () => void): () => void {
  settledListeners.add(listener);
  return () => {
    settledListeners.delete(listener);
  };
}

/** Registers a form's unsaved changes for as long as it has them and is on the page. */
export function useUnsavedChanges(dirty: boolean): void {
  const form = useId();
  useEffect(() => {
    markUnsaved(form, dirty);
    return () => markUnsaved(form, false);
  }, [form, dirty]);
}
