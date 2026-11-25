/*
 * The staff gates' headings and tab titles (F5 design 1.8, 1.10), outside the client component
 * so the server's page metadata can use them.
 */

export type GateKind =
  | 'twoFactor'
  | 'noAccess'
  | 'nothingHere'
  | 'notFound'
  /** F6 A18.2: KITCHEN and CONTENT_EDITOR at a Partners address. */
  | 'partnersNoAccess'
  /** F6 A20.1: an unknown, non-UUID or withdrawn application. */
  | 'applicationNotFound'
  /** F8 A47.2: KITCHEN and CONTENT_EDITOR at the live map's address. */
  | 'liveMapNoAccess';

export const GATE_TITLES: Record<GateKind, string> = {
  twoFactor: 'Two-factor sign-in needed',
  noAccess: "You don't have access to this page",
  nothingHere: 'Nothing here yet',
  notFound: 'Order not found',
  partnersNoAccess: "You don't have access to this page",
  applicationNotFound: 'Application not found',
  liveMapNoAccess: 'No access',
};

/** Before " | Foodz Admin". */
export const GATE_TAB_TITLES: Record<GateKind, string> = {
  twoFactor: 'Two-factor sign-in needed',
  noAccess: 'No access',
  nothingHere: 'Staff tools',
  notFound: 'Order not found',
  partnersNoAccess: 'No access',
  applicationNotFound: 'Application not found',
  liveMapNoAccess: 'No access',
};
