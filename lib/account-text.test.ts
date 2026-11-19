import { describe, expect, it } from 'vitest';
import {
  clockTime,
  clockTimeAfter,
  deliveryText,
  deviceActivityText,
  deviceName,
  initialOf,
  itemsText,
  lastActiveText,
  radiusText,
  resendCountdownText,
  shortDate,
} from './account-text';

describe('initialOf', () => {
  it('takes the first letter of any script, in capitals', () => {
    expect(initialOf('maya Lopez')).toBe('M');
    expect(initialOf('  김민지')).toBe('김');
    expect(initialOf('élodie')).toBe('É');
    // A letter with a combining accent stays one character.
    expect(initialOf('émile')).toBe('É');
    expect(initialOf('')).toBe('?');
  });
});

describe('itemsText', () => {
  it('counts items, keeping the number and the word on one line', () => {
    expect(itemsText(1)).toBe('(1 item)');
    expect(itemsText(3)).toBe('(3 items)');
  });
});

describe('dates and times', () => {
  const now = new Date('2026-11-16T18:00:00Z');

  it('formats dates the British way', () => {
    expect(shortDate('2026-11-12T09:00:00Z', 'UTC')).toBe('12 Nov 2026');
  });

  it('formats clock times in lower case', () => {
    expect(clockTime(new Date('2026-11-16T18:40:00Z'), 'UTC')).toBe('6:40 pm');
    expect(clockTime(new Date('2026-11-16T09:05:00Z'), 'UTC')).toBe('9:05 am');
    expect(clockTimeAfter(40 * 60, now, 'UTC')).toBe('6:40 pm');
  });

  it('says when a device was last active', () => {
    expect(lastActiveText('2026-11-16T10:00:00Z', true, now)).toBe('Active now');
    expect(lastActiveText('2026-11-16T10:00:00Z', false, now)).toBe('Last active today');
    expect(lastActiveText('2026-11-15T10:00:00Z', false, now)).toBe('Last active yesterday');
    expect(lastActiveText('2026-11-14T10:00:00Z', false, now)).toBe('Last active 2 days ago');
    expect(
      deviceActivityText(
        {
          signedInAt: '2026-11-03T10:00:00Z',
          lastActiveAt: '2026-11-14T10:00:00Z',
          isCurrent: false,
        },
        now,
        'UTC',
      ),
    ).toBe('Signed in 3 Nov 2026 · Last active 2 days ago');
  });

  it('names unknown devices in plain words', () => {
    expect(deviceName('Unknown browser')).toBe("A browser we don't recognise");
    expect(deviceName('Safari on iPhone')).toBe('Safari on iPhone');
  });

  it('counts down whole seconds', () => {
    expect(resendCountdownText(44.2)).toBe('You can resend in 45 s');
    expect(resendCountdownText(0)).toBe('You can resend in 1 s');
  });
});

describe('deliveryText', () => {
  const store = { radiusKm: 8, storeStreet: '88 Harbor Street' };

  it('reads inside results', () => {
    expect(deliveryText({ ...store, deliverable: true, distanceKm: 4.3 }, 'x')).toBe(
      'We deliver here · about 4.3 km from our kitchen',
    );
    expect(deliveryText({ ...store, deliverable: true, distanceKm: 8 }, 'x')).toBe(
      'We deliver here · just under 8 km from our kitchen',
    );
    expect(deliveryText({ ...store, deliverable: true, distanceKm: 0 }, 'x')).toBe(
      'We deliver here · less than 0.1 km from our kitchen',
    );
  });

  it('reads outside results with the place', () => {
    expect(
      deliveryText({ ...store, deliverable: false, distanceKm: 11.5 }, '1 Quincy Center Plaza'),
    ).toBe(
      "Sorry, we don't deliver to 1 Quincy Center Plaza yet. It's about 11.5 km from our kitchen at 88 Harbor Street, and we deliver within 8 km.",
    );
    expect(deliveryText({ ...store, deliverable: false, distanceKm: 8 }, 'this spot')).toBe(
      "Sorry, we don't deliver to this spot yet. It's just over 8 km from our kitchen at 88 Harbor Street, and we deliver within 8 km.",
    );
  });

  it('groups thousands the en-US way and keeps the unit with its number', () => {
    expect(deliveryText({ ...store, deliverable: false, distanceKm: 2839.74 }, 'Aurora')).toBe(
      "Sorry, we don't deliver to Aurora yet. It's about 2,839.7 km from our kitchen at 88 Harbor Street, and we deliver within 8 km.",
    );
    expect(deliveryText({ ...store, deliverable: true, distanceKm: 3 }, 'x')).toBe(
      'We deliver here · about 3.0 km from our kitchen',
    );
  });

  it('keeps a fractional radius to one decimal', () => {
    expect(
      deliveryText({ deliverable: false, distanceKm: 9, radiusKm: 7.5, storeStreet: 'A St' }, 'B'),
    ).toContain('we deliver within 7.5 km.');
    expect(radiusText(8)).toBe('8 km');
    expect(radiusText(12.25)).toBe('12.3 km');
  });
});
