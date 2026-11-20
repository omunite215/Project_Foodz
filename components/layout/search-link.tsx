'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { prefersReducedMotion } from '@/lib/motion';

/** The menu's search field and its toolbar (design 5.3). */
export const MENU_SEARCH_ID = 'menu-search';

/** Focuses the menu's search field and brings its toolbar to the top of the screen. */
export function focusMenuSearch(): boolean {
  const field = document.getElementById(MENU_SEARCH_ID);
  if (!(field instanceof HTMLInputElement)) return false;
  field.closest('[data-menu-toolbar]')?.scrollIntoView({
    block: 'start',
    behavior: prefersReducedMotion() ? 'instant' : 'smooth',
  });
  field.focus({ preventScroll: true });
  return true;
}

/**
 * The header's search icon (F3 S6.16, design 1.1): opens the menu with its search field focused.
 * On the menu itself it only moves focus there.
 */
export function SearchLink() {
  const pathname = usePathname();
  return (
    <Link
      href="/menu#search"
      aria-label="Search the menu"
      onClick={(event) => {
        if (pathname !== '/menu' || event.metaKey || event.ctrlKey || event.shiftKey) return;
        if (focusMenuSearch()) event.preventDefault();
      }}
      className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-neutral-2 hover:bg-neutral-7"
    >
      <Search className="size-6" aria-hidden />
    </Link>
  );
}
