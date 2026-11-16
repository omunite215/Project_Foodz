import type { Route } from 'next';

export interface NavLink {
  label: string;
  href: Route;
}

/** The main navigation, in the order it appears in the header. */
export const NAV_LINKS: readonly NavLink[] = [
  { label: 'Home', href: '/' },
  { label: 'Menu', href: '/menu' },
  { label: 'Blog', href: '/blog' },
  { label: 'Contact', href: '/contact' },
];

/**
 * Whether a navigation entry is the section the visitor is in. Home matches only "/"; every
 * other entry also matches the pages under it, so "Menu" stays marked on a dish page.
 */
export function isCurrentSection(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

const SITE_PATH = /^\/(?![/\\])\S*$/;

/** A path on this site ("/menu?cuisine=korean"), as opposed to another origin. */
export function isSitePath(href: string): href is Route {
  return SITE_PATH.test(href);
}

/** Where a URL points on this site, without its query or hash: "/menu?cuisine=thai" gives "/menu". */
export function pathOf(url: string): string {
  return url.split(/[?#]/, 1)[0] ?? url;
}
