import { describe, expect, it } from 'vitest';
import { can, isRole, isStaff, type Permission, type Role, ROLES } from './roles';

// Each row: a permission and exactly which roles hold it. Anything not listed is denied.
const MATRIX: [Permission, Role[]][] = [
  [{ order: ['create'] }, ['customer', 'partner']],
  [{ order: ['read-any'] }, ['kitchen', 'support', 'admin']],
  [{ order: ['update-status'] }, ['kitchen', 'admin']],
  [{ order: ['refund'] }, ['support', 'admin']],
  [{ menu: ['create'] }, ['content_editor', 'admin']],
  [{ menu: ['delete'] }, ['admin']],
  [{ coupon: ['create'] }, ['admin']],
  [{ campaign: ['create'] }, ['content_editor', 'admin']],
  [{ content: ['publish'] }, ['content_editor', 'admin']],
  [{ settings: ['update'] }, ['admin']],
  [{ partner: ['deliver'] }, ['partner']],
  [{ partner: ['review-application'] }, ['support', 'admin']],
  [{ delivery: ['dispatch'] }, ['admin']],
  [{ support: ['decide-refund'] }, ['support', 'admin']],
  [{ support: ['ban-member'] }, ['support', 'admin']],
  [{ analytics: ['read'] }, ['admin']],
  [{ audit: ['read'] }, ['admin']],
  [{ staff: ['assign-role'] }, ['admin']],
  [{ user: ['ban'] }, ['admin']],
  [{ user: ['impersonate'] }, []],
  [{ user: ['get'] }, ['admin']],
  [
    { account: ['update-own'] },
    ['customer', 'partner', 'kitchen', 'support', 'content_editor', 'admin'],
  ],
  [
    { account: ['export-own'] },
    ['customer', 'partner', 'kitchen', 'support', 'content_editor', 'admin'],
  ],
  // Staff accounts are removed by an admin, which also protects the last admin.
  [{ account: ['delete-own'] }, ['customer', 'partner']],
  [
    { address: ['manage-own'] },
    ['customer', 'partner', 'kitchen', 'support', 'content_editor', 'admin'],
  ],
];

describe('permission matrix', () => {
  for (const [permission, allowed] of MATRIX) {
    for (const role of ROLES) {
      const expected = allowed.includes(role);
      it(`${role} ${expected ? 'can' : 'cannot'} ${JSON.stringify(permission)}`, () => {
        expect(can(role, permission)).toBe(expected);
      });
    }
  }

  it('never lets kitchen staff refund or manage content', () => {
    expect(can('kitchen', { order: ['refund'] })).toBe(false);
    expect(can('kitchen', { content: ['update'] })).toBe(false);
  });

  it('does not let support staff publish site content', () => {
    expect(can('support', { content: ['publish'] })).toBe(false);
  });
});

describe('role helpers', () => {
  it('recognises only known roles', () => {
    expect(isRole('admin')).toBe(true);
    expect(isRole('superuser')).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });

  it('treats kitchen, support, content editors and admins as staff', () => {
    expect(ROLES.filter(isStaff)).toEqual(['kitchen', 'support', 'content_editor', 'admin']);
  });
});
