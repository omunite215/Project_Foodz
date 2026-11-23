'use client';

import { createContext, use } from 'react';

/*
 * Where overlays (dialogs, sheets, menus) are portalled. By default that is the page's body; the
 * partner app sets its own root here, so its overlays keep its light or dark theme (F6 design
 * 0.4), which lives on that root rather than on <html>.
 */

export const PortalContainerContext = createContext<HTMLElement | null>(null);

/** The element overlays render into, or undefined for the body. */
export function usePortalContainer(): HTMLElement | undefined {
  return use(PortalContainerContext) ?? undefined;
}
