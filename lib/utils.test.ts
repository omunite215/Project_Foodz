import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('keeps a text color next to a design-token font size', () => {
    expect(cn('text-primary-foreground', 'text-button-1')).toBe(
      'text-primary-foreground text-button-1',
    );
    expect(cn('text-h1 text-neutral-2')).toBe('text-h1 text-neutral-2');
  });

  it('lets a later font size replace an earlier one', () => {
    expect(cn('text-sm', 'text-body-2')).toBe('text-body-2');
    expect(cn('text-h1', 'text-h3')).toBe('text-h3');
  });

  it('still lets a later color replace an earlier one', () => {
    expect(cn('text-neutral-4', 'text-brand')).toBe('text-brand');
  });

  it('accepts clsx-style conditionals', () => {
    expect(cn('px-2', ['rounded'], { hidden: false, 'px-4': true })).toBe('rounded px-4');
  });
});
