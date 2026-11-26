import { describe, expect, it } from 'vitest';
import {
  adjustmentText,
  balanceParts,
  balanceText,
  csvNameSuffix,
  customLinkText,
  emptyRangeText,
  partnerCount,
  rangeButtonText,
  rangeCaption,
  reportFileName,
  resultCountWords,
  shortRange,
  sortWords,
  spokenRange,
  tableCaption,
  totalsBalanceLines,
  totalsLabel,
} from './report-text';

describe('ranges', () => {
  it('reads a range inside one month short', () => {
    expect(shortRange('2026-11-09', '2026-11-15')).toBe('Nov 9 – 15');
  });

  it('names both months when the range crosses one', () => {
    expect(shortRange('2026-11-30', '2026-12-06')).toBe('Nov 30 – Dec 6');
  });

  it('names both years when the range crosses one', () => {
    expect(shortRange('2026-12-28', '2027-01-03')).toBe('Dec 28, 2026 – Jan 3, 2027');
    expect(spokenRange('2026-12-28', '2027-01-03')).toBe('Dec 28, 2026 to Jan 3, 2027');
  });

  it('reads one day once', () => {
    expect(shortRange('2026-11-20', '2026-11-20')).toBe('Nov 20');
    expect(spokenRange('2026-11-20', '2026-11-20')).toBe('Nov 20');
  });

  it('says the range aloud with both months (A68.2)', () => {
    expect(spokenRange('2026-11-09', '2026-11-15')).toBe('Nov 9 to Nov 15');
  });

  it('captions the range with weekdays, the year and the zone', () => {
    expect(rangeCaption('2026-11-09', '2026-11-15')).toBe(
      'Mon, Nov 9 – Sun, Nov 15, 2026 · Dates and times are Boston time.',
    );
    expect(rangeCaption('2026-12-28', '2027-01-03')).toBe(
      'Mon, Dec 28, 2026 – Sun, Jan 3, 2027 · Dates and times are Boston time.',
    );
    expect(rangeCaption('2026-11-20', '2026-11-20')).toBe(
      'Fri, Nov 20, 2026 · Dates and times are Boston time.',
    );
  });

  it('keeps calendar days whatever the clock zone', () => {
    // A date read at UTC midnight would be the day before in Boston; these are store dates.
    expect(shortRange('2026-03-01', '2026-03-07')).toBe('Mar 1 – 7');
  });

  it('labels the phone button and the custom link', () => {
    expect(rangeButtonText('last-week', '2026-11-09', '2026-11-15')).toBe('Last week · Nov 9 – 15');
    expect(customLinkText(false, '2026-11-03', '2026-11-12')).toBe('Custom');
    expect(customLinkText(true, '2026-11-03', '2026-11-12')).toBe('Custom · Nov 3 – 12');
  });
});

describe('balances and amounts', () => {
  it('says who owes whom, never with a sign', () => {
    expect(balanceText(6_705)).toBe('Foodz owes $67.05');
    expect(balanceText(-14_270)).toBe('Owes $142.70');
    expect(balanceText(0)).toBe('$0.00');
  });

  it('splits a balance before its amount, so it wraps there', () => {
    expect(balanceParts(6_705)).toEqual({ lead: 'Foodz owes', amount: '$67.05' });
    expect(balanceParts(0)).toEqual({ lead: null, amount: '$0.00' });
  });

  it('signs bonuses and adjustments only when negative, with a real minus', () => {
    expect(adjustmentText(0)).toBe('$0.00');
    expect(adjustmentText(300)).toBe('$3.00');
    expect(adjustmentText(-200)).toBe('−$2.00');
  });

  it('keeps the two balance totals apart (conflict 8)', () => {
    expect(totalsBalanceLines({ foodzOwesCents: 9_640, owedToFoodzCents: 0 })).toEqual([
      'Foodz owes $96.40',
      'Owed to Foodz $0.00',
    ]);
  });
});

describe('counts and captions', () => {
  it('counts partners', () => {
    expect(partnerCount(1)).toBe('1 partner');
    expect(partnerCount(2)).toBe('2 partners');
    expect(resultCountWords(0)).toBe('No partners');
    expect(resultCountWords(1)).toBe('1 partner');
    expect(totalsLabel(2)).toBe('Totals · 2 partners');
  });

  it('names the order in words', () => {
    expect(sortWords('partner', 'asc')).toBe('partner A to Z');
    expect(sortWords('partner', 'desc')).toBe('partner Z to A');
    expect(sortWords('closing', 'desc')).toBe('closing balance, highest first');
    expect(sortWords('earned', 'asc')).toBe('earned, lowest first');
  });

  it('captions the table with range, order and count', () => {
    expect(tableCaption({ from: '2026-11-09', to: '2026-11-15' }, 'partner', 'asc', 2)).toBe(
      'Partner earnings, Nov 9 to Nov 15, 2026, partner A to Z, 2 partners',
    );
  });
});

describe('the CSV and the empty range', () => {
  it('names the download for its range', () => {
    expect(csvNameSuffix('2026-11-09', '2026-11-15')).toBe('for Nov 9 to Nov 15');
  });

  it('keeps people out of the file name (A64.1)', () => {
    expect(reportFileName('2026-11-09', '2026-11-15')).toBe(
      'foodz-partner-earnings-2026-11-09-to-2026-11-15.csv',
    );
  });

  it('says what an empty range covered', () => {
    expect(emptyRangeText('2026-11-09', '2026-11-15')).toBe(
      'No partner had entries or a balance between Nov 9 and Nov 15.',
    );
    expect(emptyRangeText('2026-11-20', '2026-11-20')).toBe(
      'No partner had entries or a balance on Nov 20.',
    );
  });
});
