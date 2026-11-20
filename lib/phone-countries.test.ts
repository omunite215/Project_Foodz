import { describe, expect, it } from 'vitest';
import { compactCountry, phoneCountries } from './phone-countries';

describe('phoneCountries', () => {
  it('puts the United States first, then sorts by name', () => {
    const countries = phoneCountries();
    expect(countries[0]).toEqual({ code: 'US', name: 'United States', dial: '+1' });
    const rest = countries.slice(1).map((country) => country.name);
    expect(rest).toEqual(rest.toSorted((a, b) => a.localeCompare(b, 'en')));
    expect(countries.find((country) => country.code === 'VN')).toEqual({
      code: 'VN',
      name: 'Vietnam',
      dial: '+84',
    });
  });

  it('shows a compact closed value', () => {
    expect(compactCountry({ code: 'US', name: 'United States', dial: '+1' })).toBe('US +1');
  });
});
