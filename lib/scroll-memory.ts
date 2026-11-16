'use client';

import { useLayoutEffect } from 'react';

/*
 * The browser restores the scroll position on Back by itself, but only if the page is already
 * rendered when it tries. When the previous page takes a moment to render (a slow phone, a busy
 * main thread) the browser restores into a page that is still too short, and the visitor lands
 * higher up than they left. A page that uses this hook remembers its own position per address
 * and puts it back once its content has mounted after a Back or Forward.
 */

const STORAGE_PREFIX = 'foodz.scroll:';
/** Closer than this to the saved position counts as already restored. */
const TOLERANCE_PX = 48;

/** The address the last Back or Forward led to, until a page claims it. */
let poppedTo: string | null = null;

const currentAddress = () => `${window.location.pathname}${window.location.search}`;

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    poppedTo = currentAddress();
  });
}

function read(address: string): number | null {
  try {
    const saved = Number(window.sessionStorage.getItem(STORAGE_PREFIX + address));
    return Number.isFinite(saved) && saved > 0 ? saved : null;
  } catch {
    return null;
  }
}

function write(address: string, y: number) {
  try {
    window.sessionStorage.setItem(STORAGE_PREFIX + address, String(Math.round(y)));
  } catch {
    // Storage blocked or full: the browser's own restoration still applies.
  }
}

/**
 * Remembers the scroll position of pages under `pathname` (any query) and restores it after a
 * Back or Forward to the same address. Call it from a component that mounts with the content.
 */
export function useScrollMemory(pathname: string) {
  useLayoutEffect(() => {
    const address = currentAddress();
    if (poppedTo === address) {
      poppedTo = null;
      const saved = read(address);
      if (saved !== null && Math.abs(window.scrollY - saved) > TOLERANCE_PX) {
        window.scrollTo({ top: saved, behavior: 'instant' });
      }
    }

    let frame = 0;
    const save = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        // Only while this page is showing: the next page's scroll-to-top must not count.
        if (window.location.pathname === pathname) write(currentAddress(), window.scrollY);
      });
    };
    window.addEventListener('scroll', save, { passive: true });
    return () => {
      window.removeEventListener('scroll', save);
      window.cancelAnimationFrame(frame);
    };
  }, [pathname]);
}
