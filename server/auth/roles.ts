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
  order: ['create', 'read-own', 'read-any', 'update-status', 'cancel', 'refund'],
  menu: ['create', 'update', 'delete'],
  coupon: ['create', 'update', 'delete'],
  campaign: ['create', 'update', 'delete'],
  blog: ['create', 'update', 'publish', 'delete'],
  content: ['update', 'publish'],
  settings: ['update'],
  partner: ['apply', 'deliver', 'review-application', 'suspend'],
  delivery: ['dispatch', 'track-any'],
  support: ['decide-refund', 'resolve-report', 'ban-member'],
  contact: ['read', 'update'],
  review: ['create', 'moderate'],
  analytics: ['read'],
  audit: ['read'],
  staff: ['assign-role'],
} as const;

export const ac = createAccessControl(statements);

const customer = ac.newRole({
  order: ['create', 'read-own', 'cancel'],
  partner: ['apply'],
  review: ['create'],
});

const partner = ac.newRole({
  order: ['create', 'read-own', 'cancel'],
  partner: ['apply', 'deliver'],
  review: ['create'],
});

const kitchen = ac.newRole({
  order: ['read-any', 'update-status'],
});

const support = ac.newRole({
  order: ['read-any', 'cancel', 'refund'],
  partner: ['review-application', 'suspend'],
  delivery: ['track-any'],
  support: ['decide-refund', 'resolve-report', 'ban-member'],
  contact: ['read', 'update'],
  review: ['moderate'],
});

const contentEditor = ac.newRole({
  menu: ['create', 'update'],
  campaign: ['create', 'update', 'delete'],
  blog: ['create', 'update', 'publish', 'delete'],
  content: ['update', 'publish'],
});

// Admins get Better Auth's user management, except impersonation.
const admin = ac.newRole({
  user: ['create', 'list', 'set-role', 'ban', 'delete', 'set-password', 'get', 'update'],
  session: ['list', 'revoke', 'delete'],
  order: ['read-any', 'update-status', 'cancel', 'refund'],
  menu: ['create', 'update', 'delete'],
  coupon: ['create', 'update', 'delete'],
  campaign: ['create', 'update', 'delete'],
  blog: ['create', 'update', 'publish', 'delete'],
  content: ['update', 'publish'],
  settings: ['update'],
  partner: ['review-application', 'suspend'],
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
