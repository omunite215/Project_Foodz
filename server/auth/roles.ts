import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements } from 'better-auth/plugins/admin/access';

export const ROLES = [
  'customer',
  'partner',
  'kitchen',
  'support',
  'content_editor',
  'admin',
] as const;
export type Role = (typeof ROLES)[number];

export const STAFF_ROLES: readonly Role[] = ['kitchen', 'support', 'content_editor', 'admin'];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function isStaff(role: Role) {
  return STAFF_ROLES.includes(role);
}

/** Everything a signed-in actor can be allowed to do. Deny unless listed. */
export const statements = {
  ...defaultStatements,
  // F5: `refuse` turns down a New order (the kitchen has no `cancel`, U2); `move-back` and
  // `hand-over` are ADMIN's overrides (A8.3, A9).
  order: [
    'create',
    'read-own',
    'read-any',
    'update-status',
    'refuse',
    'move-back',
    'hand-over',
    'cancel',
    'refund',
  ],
  // `update-availability` is "86 it" from the board: sold out or back on, nothing else.
  menu: ['create', 'update', 'delete', 'update-availability'],
  coupon: ['create', 'update', 'delete'],
  campaign: ['create', 'update', 'delete'],
  blog: ['create', 'update', 'publish', 'delete'],
  content: ['update', 'publish'],
  settings: ['update'],
  // F6: `reinstate` gives a suspended partner access back and reopens a rejection (U27, B24).
  partner: ['apply', 'deliver', 'review-application', 'suspend', 'reinstate'],
  delivery: ['dispatch', 'track-any'],
  support: ['decide-refund', 'resolve-report', 'ban-member'],
  contact: ['read', 'update'],
  review: ['create', 'moderate'],
  analytics: ['read'],
  audit: ['read'],
  staff: ['assign-role'],
  // Self-service on one's own account and address book.
  account: ['update-own', 'export-own', 'delete-own'],
  address: ['manage-own'],
  // Hearted dishes (F3). The shared demo customer may use them: they hold no personal data.
  favorite: ['manage-own'],
} as const;

export const ac = createAccessControl(statements);

/**
 * Everyone manages their own profile, addresses and favorites. Staff accounts are removed by an
 * admin.
 */
const selfService = {
  account: ['update-own', 'export-own'],
  address: ['manage-own'],
  favorite: ['manage-own'],
} as const;
const selfServiceWithDelete = {
  account: ['update-own', 'export-own', 'delete-own'],
  address: ['manage-own'],
  favorite: ['manage-own'],
} as const;

const customer = ac.newRole({
  ...selfServiceWithDelete,
  order: ['create', 'read-own', 'cancel'],
  partner: ['apply'],
  review: ['create'],
});

const partner = ac.newRole({
  ...selfServiceWithDelete,
  order: ['create', 'read-own', 'cancel'],
  partner: ['apply', 'deliver'],
  review: ['create'],
});

const kitchen = ac.newRole({
  ...selfService,
  order: ['read-any', 'update-status', 'refuse'],
  menu: ['update-availability'],
});

const support = ac.newRole({
  ...selfService,
  order: ['read-any', 'cancel', 'refund'],
  partner: ['review-application', 'suspend'],
  delivery: ['track-any'],
  support: ['decide-refund', 'resolve-report', 'ban-member'],
  contact: ['read', 'update'],
  review: ['moderate'],
});

const contentEditor = ac.newRole({
  ...selfService,
  menu: ['create', 'update'],
  campaign: ['create', 'update', 'delete'],
  blog: ['create', 'update', 'publish', 'delete'],
  content: ['update', 'publish'],
});

// Admins get Better Auth's user management, except impersonation.
const admin = ac.newRole({
  ...selfService,
  user: ['create', 'list', 'set-role', 'ban', 'delete', 'set-password', 'get', 'update'],
  session: ['list', 'revoke', 'delete'],
  // No `refuse`: ADMIN cancels New orders as a staff cancellation (design D14).
  order: ['read-any', 'update-status', 'move-back', 'hand-over', 'cancel', 'refund'],
  menu: ['create', 'update', 'delete', 'update-availability'],
  coupon: ['create', 'update', 'delete'],
  campaign: ['create', 'update', 'delete'],
  blog: ['create', 'update', 'publish', 'delete'],
  content: ['update', 'publish'],
  settings: ['update'],
  partner: ['review-application', 'suspend', 'reinstate'],
  delivery: ['dispatch', 'track-any'],
  support: ['decide-refund', 'resolve-report', 'ban-member'],
  contact: ['read', 'update'],
  review: ['moderate'],
  analytics: ['read'],
  audit: ['read'],
  staff: ['assign-role'],
});

export const roles = {
  customer,
  partner,
  kitchen,
  support,
  content_editor: contentEditor,
  admin,
} satisfies Record<Role, unknown>;

export type Permission = {
  [K in keyof typeof statements]?: readonly (typeof statements)[K][number][];
};

export function can(role: Role, permission: Permission): boolean {
  return roles[role].authorize(permission).success;
}
