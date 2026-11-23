/*
 * The staff gates' headings and tab titles (F5 design 1.8, 1.10), outside the client component
 * so the server's page metadata can use them.
 */

export type GateKind = 'twoFactor' | 'noAccess' | 'nothingHere' | 'notFound';

export const GATE_TITLES: Record<GateKind, string> = {
  twoFactor: 'Two-factor sign-in needed',
  noAccess: "You don't have access to this page",
  nothingHere: 'Nothing here yet',
  notFound: 'Order not found',
};

/** Before " | Foodz Admin". */
export const GATE_TAB_TITLES: Record<GateKind, string> = {
  twoFactor: 'Two-factor sign-in needed',
  noAccess: 'No access',
  nothingHere: 'Staff tools',
  notFound: 'Order not found',
};
