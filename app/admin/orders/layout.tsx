import type { ReactNode } from 'react';

/**
 * The board and, over it, the detail panel (an intercepted route in the `panel` slot, F5
 * design 5.1). Loaded directly, an order's address renders the full page instead.
 */
export default function OrdersLayout({
  children,
  panel,
}: {
  children: ReactNode;
  panel: ReactNode;
}) {
  return (
    <>
      {children}
      {panel}
    </>
  );
}
