'use client';

import { useLayoutEffect } from 'react';

/*
 * The browser restores the scroll position on Back by itself, but only if the page is already
 * rendered when it tries. When the previous page takes a moment to render (a slow phone, a busy
 * main thread) the browser restores into a page that is still too short, and the visitor lands
 * higher up than they left. A page that uses this hook remembers its own position per address
 * and puts it back once its content has mounted after a Back or Forward.
 *
 * It also remembers which link was followed and focuses it again, so a keyboard user continues
 * from that dish instead of from the top of the page.
 */

const STORAGE_PREFIX = 'foodz.scroll:';
const FOLLOWED_PREFIX = 'foodz.followed:';
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

interface FollowedLink {
  href: string;
  /** Which of the links with this href (a dish can be in the specials and in the list). */
  index: number;
}

const linksTo = (href: string) =>
  [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].filter(
    (link) => link.getAttribute('href') === href,
  );

function readFollowed(address: string): FollowedLink | null {
  try {
    const raw = window.sessionStorage.getItem(FOLLOWED_PREFIX + address);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'href' in parsed &&
      'index' in parsed &&
      typeof parsed.href === 'string' &&
      typeof parsed.index === 'number'
    ) {
      return { href: parsed.href, index: parsed.index };
    }
    return null;
  } catch {
    return null;
  }
}

function writeFollowed(address: string, link: FollowedLink) {
  try {
    window.sessionStorage.setItem(FOLLOWED_PREFIX + address, JSON.stringify(link));
  } catch {
    // Storage blocked: focus simply starts from the top after Back.
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
      const followed = readFollowed(address);
      if (followed) {
        const links = linksTo(followed.href);
        (links[followed.index] ?? links[0])?.focus({ preventScroll: true });
      }
    }

    const remember = (event: MouseEvent) => {
      if (window.location.pathname !== pathname || !(event.target instanceof Element)) return;
      const link = event.target.closest('a[href]');
      const href = link?.getAttribute('href');
      if (!(link instanceof HTMLAnchorElement) || !href) return;
      writeFollowed(currentAddress(), { href, index: linksTo(href).indexOf(link) });
    };
    // Capture phase: recorded before the link's own handler starts the navigation.
    document.addEventListener('click', remember, true);

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
      document.removeEventListener('click', remember, true);
      window.cancelAnimationFrame(frame);
    };
  }, [pathname]);
}
