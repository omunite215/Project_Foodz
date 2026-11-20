import { type CountryCode, getCountries, parsePhoneNumberFromString } from 'libphonenumber-js';

/**
 * Phone numbers for the profile (S5.2). The same rule runs in the browser and on the server:
 * a number is accepted when it is a callable number for the chosen country (or carries its own
 * +country code), and it is stored in E.164 ("+16175550142").
 */

export const DEFAULT_PHONE_COUNTRY = 'US';

const COUNTRIES = new Set<string>(getCountries());

export function isPhoneCountry(value: string): value is CountryCode {
  return COUNTRIES.has(value);
}

export interface ParsedPhone {
  /** E.164, e.g. "+16175550142". */
  e164: string;
  /** ISO 3166-1 alpha-2 of the number itself, e.g. "US". */
  country: string;
  /** "(617) 555-0142" at home, "+84 12 346 57 98" elsewhere. */
  display: string;
}

/** Null when the text is not a number that can be called. */
export function parsePhone(
  raw: string,
  country: string = DEFAULT_PHONE_COUNTRY,
): ParsedPhone | null {
  const text = raw.trim();
  if (!text || text.length > 32 || !isPhoneCountry(country)) return null;
  const phone = parsePhoneNumberFromString(text, country);
  if (!phone?.isValid()) return null;
  const numberCountry = phone.country ?? country;
  return {
    e164: phone.number,
    country: numberCountry,
    display:
      numberCountry === DEFAULT_PHONE_COUNTRY
        ? phone.formatNational()
        : phone.formatInternational(),
  };
}

/** How a stored E.164 number is shown back. */
export function displayPhone(e164: string): { country: string | null; display: string } {
  const phone = parsePhoneNumberFromString(e164);
  if (!phone) return { country: null, display: e164 };
  const country = phone.country ?? null;
  return {
    country,
    display:
      country === DEFAULT_PHONE_COUNTRY ? phone.formatNational() : phone.formatInternational(),
  };
}
