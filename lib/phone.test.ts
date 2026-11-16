import { describe, expect, it } from 'vitest';
import { displayPhone, parsePhone } from './phone';

describe('parsePhone', () => {
  it.each(['(617) 555-0142', '617-555-0142', '+1 617 555 0142', '6175550142'])(
    'stores %j as one E.164 number shown as (617) 555-0142',
    (raw) => {
      expect(parsePhone(raw, 'US')).toEqual({
        e164: '+16175550142',
        country: 'US',
        display: '(617) 555-0142',
      });
    },
  );

  it('accepts a Vietnamese number with Vietnam chosen', () => {
    expect(parsePhone('+84 123 465 798', 'VN')).toMatchObject({
      e164: '+84123465798',
      country: 'VN',
    });
    expect(parsePhone('123 465 798', 'VN')).toMatchObject({ e164: '+84123465798' });
  });

  it('follows a +country code over the chosen country', () => {
    expect(parsePhone('+1 617 555 0142', 'VN')).toMatchObject({
      e164: '+16175550142',
      country: 'US',
    });
  });

  it.each([
    ['555-0142', 'US'],
    ['12', 'US'],
    ['(617) 555-01422', 'US'],
    ['call me', 'US'],
    ['', 'US'],
    ['(617) 555-0142', 'XX'],
    [`+1 617 555 0142${' '.repeat(40)}0`, 'US'],
  ])('refuses %j (%s)', (raw, country) => {
    expect(parsePhone(raw, country)).toBeNull();
  });
});

describe('displayPhone', () => {
  it('formats stored numbers', () => {
    expect(displayPhone('+16175550142')).toEqual({ country: 'US', display: '(617) 555-0142' });
    expect(displayPhone('+442079460958')).toEqual({ country: 'GB', display: '+44 20 7946 0958' });
    expect(displayPhone('not a number').display).toBe('not a number');
  });
});
