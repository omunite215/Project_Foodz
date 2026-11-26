/*
 * The CSV writer for the payouts report and a partner's entries (A64, B11): UTF-8 with a byte
 * order mark so spreadsheets read accents, commas, CRLF, a header row, money from cents with
 * integer maths, and a guard so a text cell can't run as a formula when the file is opened.
 */

const BOM = '﻿';

/** A cell the writer leaves exactly as given (amounts and counts); never prefixed. */
export interface CsvNumber {
  readonly kind: 'number';
  readonly value: string;
}

export type CsvCell = string | CsvNumber | null;

/** 12602 → "126.02", -14270 → "-142.70", built from cents with integer maths (E4.1). */
export function centsToDecimal(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError('cents must be a safe integer');
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  const dollars = Math.trunc(absolute / 100);
  const rest = absolute % 100;
  return `${sign}${dollars}.${String(rest).padStart(2, '0')}`;
}

export const money = (cents: number): CsvNumber => ({
  kind: 'number',
  value: centsToDecimal(cents),
});
export const count = (value: number): CsvNumber => ({
  kind: 'number',
  value: String(Math.trunc(value)),
});

const RISKY_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

/** A64.2: a text cell starting with = + - @ tab or CR gets a leading apostrophe. */
export function textCell(value: string): string {
  const guarded = RISKY_START.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

function cell(value: CsvCell): string {
  if (value === null) return '';
  if (typeof value === 'string') return textCell(value);
  return value.value;
}

export function csvLine(cells: readonly CsvCell[]): string {
  return cells.map(cell).join(',');
}

/** The whole file: BOM, header, rows, CRLF after every line. */
export function toCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  return `${BOM}${[csvLine(header), ...rows.map(csvLine)].join('\r\n')}\r\n`;
}
