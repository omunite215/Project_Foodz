'use client';

import { useEffect, useRef } from 'react';

/*
 * Back closes a dialog (F3 S1.3, design D2). Opening adds a history entry on the same address
 * (`history.pushState`, which the App Router takes into its own history state, so the entry stays
 * one it can restore); a Back or a swipe that leaves that entry closes the dialog and leaves the
 * page as it was. Closing from inside (Close, Escape, the overlay) steps back over the entry, so
 * none is left behind. A link inside the dialog replaces the entry with its own page instead.
 */

export type DialogHistoryKey = 'foodzCart' | 'foodzFilters';

const isOurs = (state: unknown, key: DialogHistoryKey) =>
  typeof state === 'object' && state !== null && Reflect.get(state, key) === true;

export interface DialogHistory {
  /** Closing from inside the dialog: the dialog closes now and its entry is stepped over. */
  close: () => void;
  /** A link inside the dialog has replaced the entry: there is nothing to step back over. */
  forget: () => void;
}

const currentAddress = () =>
  `${window.location.pathname}${window.location.search}${window.location.hash}`;

/**
 * Rewrites the address without a history entry or a request, keeping any dialog's own mark on
 * the entry (the App Router adds its internal state and picks up the new address).
 */
export function replaceAddress(href: string) {
  const state: unknown = window.history.state;
  const own =
    typeof state === 'object' && state !== null
      ? Object.fromEntries(Object.entries(state).filter(([name]) => !name.startsWith('__')))
      : null;
  window.history.replaceState(own, '', href);
}

/** After stepping back over a dialog's entry, the page keeps the address it had in the dialog. */
function keepAddress(wanted: string | null) {
  if (wanted && wanted !== currentAddress()) replaceAddress(wanted);
}

export function useDialogHistory(
  key: DialogHistoryKey,
  open: boolean,
  onClosed: () => void,
): DialogHistory {
  const pushed = useRef(false);
  const latest = useRef(onClosed);
  // The filters change the address while their sheet is open: that is the address to keep.
  const lastAddress = useRef<string | null>(null);
  useEffect(() => {
    latest.current = onClosed;
    if (open) lastAddress.current = currentAddress();
  });

  useEffect(() => {
    if (!open) return undefined;
    // Run twice in development: the entry is only added once.
    if (!isOurs(window.history.state, key)) window.history.pushState({ [key]: true }, '');
    pushed.current = true;
    const onPop = (event: PopStateEvent) => {
      if (isOurs(event.state, key)) return;
      pushed.current = false;
      keepAddress(lastAddress.current);
      latest.current();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [open, key]);

  return {
    close: () => {
      const ours = pushed.current && isOurs(window.history.state, key);
      pushed.current = false;
      const address = currentAddress();
      latest.current();
      if (!ours) return;
      window.addEventListener('popstate', () => keepAddress(address), { once: true });
      window.history.back();
    },
    forget: () => {
      pushed.current = false;
    },
  };
}
