/*
 * The page the visitor was on before this one, within this tab. "Go back" on a dish page uses it
 * to return to the menu with its tab and scroll position (browser back) instead of reloading it.
 */

let current: string | null = null;
let previous: string | null = null;

/** Called on every route change with the new pathname and query. */
export function rememberRoute(url: string): void {
  if (url === current) return;
  // A tab switch replaces the menu's query without adding a history entry.
  const samePage = current !== null && url.split('?')[0] === current.split('?')[0];
  if (!samePage) previous = current;
  current = url;
}

export function previousRoute(): string | null {
  return previous;
}
