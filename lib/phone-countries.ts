import { getCountries, getCountryCallingCode } from 'libphonenumber-js';
import { DEFAULT_PHONE_COUNTRY } from './phone';

export interface PhoneCountry {
  /** ISO 3166-1 alpha-2, e.g. "VN". */
  code: string;
  /** "Vietnam". */
  name: string;
  /** "+84". */
  dial: string;
}

/**
 * Countries for the phone field's code picker: United States first (the store is in Boston),
 * then the rest A to Z by their English names.
 */
export function phoneCountries(): PhoneCountry[] {
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  const all = getCountries().map((code) => ({
    code,
    name: names.of(code) ?? code,
    dial: `+${getCountryCallingCode(code)}`,
  }));
  const home = all.find((country) => country.code === DEFAULT_PHONE_COUNTRY);
  const rest = all
    .filter((country) => country.code !== DEFAULT_PHONE_COUNTRY)
    .toSorted((a, b) => a.name.localeCompare(b.name, 'en'));
  return home ? [home, ...rest] : rest;
}

/** The closed picker's compact text: "US +1". */
export const compactCountry = (country: PhoneCountry) => `${country.code} ${country.dial}`;
