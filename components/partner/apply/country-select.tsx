'use client';

import { ChevronDown } from 'lucide-react';
import { compactCountry, type PhoneCountry } from '@/lib/phone-countries';

/**
 * F2's country code select (design 4.2) in the partner app's colours: a compact "US +1" over a
 * native select whose options read in full ("United States (+1)").
 */
export function CountrySelect({
  countries,
  value,
  onChange,
}: {
  countries: readonly PhoneCountry[];
  value: string;
  onChange: (code: string) => void;
}) {
  const current = countries.find((country) => country.code === value) ?? countries[0];
  return (
    <div className="relative flex h-12 items-center justify-between rounded-xl border border-input bg-card px-4 text-body-4 text-strong has-[select:focus-visible]:outline-2 has-[select:focus-visible]:outline-offset-2 has-[select:focus-visible]:outline-ring has-[select:focus-visible]:outline-solid">
      <span aria-hidden>{current ? compactCountry(current) : value}</span>
      <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
      <select
        aria-label="Country code"
        value={current?.code ?? value}
        onChange={(event) => onChange(event.target.value)}
        className="absolute inset-0 cursor-pointer bg-card text-strong opacity-0 outline-none"
      >
        {countries.map((country) => (
          <option key={country.code} value={country.code}>
            {country.name} ({country.dial})
          </option>
        ))}
      </select>
    </div>
  );
}
