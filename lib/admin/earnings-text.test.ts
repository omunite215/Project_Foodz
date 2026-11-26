import { describe, expect, it } from 'vitest';
import type { LedgerRow, PartnerBalance } from '@/server/modules/earnings/schema';
import type { StaffRatingRow } from '@/server/modules/ratings/schema';
import {
  adjustActionLabel,
  adjustOutcome,
  amountText,
  balanceHeading,
  balanceText,
  cashActionLabel,
  cashBlock,
  cashOutcome,
  commentPreview,
  dayRange,
  entriesCsvSuffix,
  entriesFileName,
  excludeButtonName,
  excludedLine,
  excludeOutcome,
  excludeTitle,
  feedbackStateLine,
  holdingLine,
  lastPayoutLine,
  ledgerCaption,
  ledgerDetails,
  ledgerEntryWords,
  ledgerRecordedBy,
  overBalance,
  overHolding,
  payoutActionLabel,
  payoutOutcome,
  rangeProblems,
  ratingCell,
  sectionOf,
  shownWords,
  showingEntries,
  sinceWords,
  spreadSr,
  tagChip,
  weekCell,
  weekHeading,
} from './earnings-text';

const TZ = 'America/New_York';
// T = Fri, Nov 20, 2026, 7:46 pm in Boston.
const T = new Date('2026-11-21T00:46:00Z');

const ledger = (patch: Partial<LedgerRow>): LedgerRow => ({
  id: 'e1',
  at: '2026-11-21T00:46:00Z',
  kind: 'DELIVERY_FEE',
  reason: null,
  message: null,
  staffNote: null,
  orderId: null,
  orderNumber: null,
  amountCents: 264,
  balanceAfterCents: 6705,
  recordedBy: { kind: 'system' },
  method: null,
  reference: null,
  paidOn: null,
  ...patch,
});

describe('the Partners list cells (design 3.2)', () => {
  it('reads the rating, with the under-5 line and the empty dash', () => {
    expect(ratingCell({ average: 4.6, count: 31, shownToCustomers: true })).toEqual({
      text: '4.6 · 31',
      second: null,
      sr: null,
    });
    expect(ratingCell({ average: 5, count: 1, shownToCustomers: false }).second).toBe(
      'not shown to customers yet',
    );
    expect(ratingCell(null)).toEqual({ text: '—', second: null, sr: 'No ratings' });
  });

  it("reads this week's deliveries and earnings", () => {
    expect(weekCell({ deliveries: 18, earnedCents: 12_602 })).toEqual(['18 deliveries', '$126.02']);
    expect(weekCell({ deliveries: 1, earnedCents: 764 })).toEqual(['1 delivery', '$7.64']);
    expect(weekCell(null)).toBeNull();
  });

  it('says the weekday within 6 days, then the date', () => {
    expect(sinceWords('2026-11-18T01:40:00Z', T, TZ)).toEqual({
      text: 'since Tue',
      spoken: 'since Tuesday',
    });
    expect(sinceWords('2026-11-09T18:00:00Z', T, TZ)).toEqual({
      text: 'since Nov 9',
      spoken: 'since Nov 9',
    });
  });

  it('gives the amber block a word the plain one lacks (conflict 11)', () => {
    const since = '2026-11-18T01:40:00Z';
    expect(cashBlock({ owedCents: 4200, since, amber: false, why: [] }, T, TZ)).toEqual({
      tone: 'plain',
      text: 'Owes $42.00',
      spoken: 'Owes Foodz $42.00',
    });
    expect(cashBlock({ owedCents: 14_270, since, amber: true, why: ['age'] }, T, TZ)).toEqual({
      tone: 'amber',
      text: 'Owes $142.70 · since Tue',
      spoken: 'Owes Foodz $142.70, since Tuesday',
    });
    expect(
      cashBlock({ owedCents: 16_480, since: T.toISOString(), amber: true, why: ['amount'] }, T, TZ),
    ).toEqual({
      tone: 'amber',
      text: 'Owes $164.80 · over $150',
      spoken: 'Owes Foodz $164.80, over $150',
    });
    expect(
      cashBlock({ owedCents: 16_480, since, amber: true, why: ['age', 'amount'] }, T, TZ).text,
    ).toBe('Owes $164.80 · since Tue');
  });
});

describe('the partner page (design 3.3, 3.4)', () => {
  it('reads the view leniently', () => {
    expect(sectionOf('ratings')).toBe('ratings');
    expect(sectionOf('application')).toBe('application');
    expect(sectionOf('nope')).toBe('earnings');
    expect(sectionOf(undefined)).toBe('earnings');
  });

  it('words each balance', () => {
    const base: PartnerBalance = {
      state: 'foodzOwes',
      balanceCents: 6705,
      holdingCents: 5897,
      owedSince: null,
      amber: false,
      why: [],
    };
    expect(balanceHeading(base, 'Luis Moreno', TZ)).toBe('Foodz owes Luis $67.05');
    expect(
      balanceHeading(
        {
          ...base,
          state: 'partnerOwes',
          balanceCents: -14_270,
          owedSince: '2026-11-18T01:40:00Z',
          amber: true,
          why: ['age'],
        },
        'Diego Alvarez',
        TZ,
      ),
    ).toBe('Diego owes Foodz $142.70 in cash · since Tue, Nov 17');
    expect(balanceHeading({ ...base, state: 'square', balanceCents: 0 }, 'Lena Fischer', TZ)).toBe(
      'All square',
    );
    expect(holdingLine(5897)).toBe("Holding $58.97 in customers' cash");
    expect(holdingLine(0)).toBeNull();
  });

  it('words the week and the last payout', () => {
    expect(weekHeading('2026-11-16', '2026-11-22')).toBe('This week · Mon, Nov 16 – Sun, Nov 22');
    expect(dayRange('2026-11-16', '2026-11-22')).toBe('Mon, Nov 16 – Sun, Nov 22');
    expect(
      lastPayoutLine({
        at: '2026-11-16T15:05:00Z',
        paidOn: '2026-11-16',
        amountCents: 9640,
        method: 'bank-transfer',
        reference: 'Week of Nov 9',
      }),
    ).toBe('Last payout: Mon, Nov 16 · $96.40 · Bank transfer · Week of Nov 9');
    expect(lastPayoutLine(null)).toBe('No payouts yet.');
  });

  it('signs balances with a real minus sign', () => {
    expect(balanceText(6705)).toBe('$67.05');
    expect(balanceText(-14_270)).toBe('−$142.70');
    expect(balanceText(0)).toBe('$0.00');
  });
});

describe('the ledger (design 3.5)', () => {
  it('words each kind of entry', () => {
    expect(ledgerEntryWords(ledger({}))).toBe('Delivery fee');
    expect(ledgerEntryWords(ledger({ reason: 'cancelled-after-pickup' }))).toBe(
      'Delivery fee · cancelled after pickup',
    );
    expect(ledgerEntryWords(ledger({ kind: 'ADJUSTMENT', reason: 'correction' }))).toBe(
      'Added · Correction',
    );
    expect(
      ledgerEntryWords(
        ledger({ kind: 'ADJUSTMENT', reason: 'cancelled-order-pay', amountCents: -200 }),
      ),
    ).toBe('Taken off · Pay for a cancelled order');
    expect(
      ledgerEntryWords(ledger({ kind: 'PAYOUT', method: 'bank-transfer', amountCents: -9640 })),
    ).toBe('Payout · Bank transfer');
  });

  it('puts the message, the reference and the note under the words', () => {
    expect(
      ledgerDetails(
        ledger({ kind: 'BONUS', message: 'Waited 20 min', staffNote: 'Kitchen was slow' }),
      ),
    ).toEqual(['“Waited 20 min”', 'Note: Kitchen was slow']);
    expect(
      ledgerDetails(
        ledger({
          kind: 'PAYOUT',
          method: 'bank-transfer',
          reference: 'Week of Nov 9',
          paidOn: '2026-11-16',
        }),
      ),
    ).toEqual(['Reference: Week of Nov 9 · paid Mon, Nov 16']);
  });

  it('names who recorded it', () => {
    expect(ledgerRecordedBy(ledger({}))).toBe('Foodz (automatic)');
    expect(
      ledgerRecordedBy(
        ledger({ recordedBy: { kind: 'staff', name: 'Morgan Diaz', role: 'support' } }),
      ),
    ).toBe('Morgan Diaz (Support)');
  });

  it('captions, counts and names the download', () => {
    expect(ledgerCaption('Luis Moreno', { from: '2026-11-16', to: '2026-11-22' }, 'desc', 23)).toBe(
      "Luis Moreno's entries, Nov 16 to Nov 22, newest first, 23 entries",
    );
    expect(showingEntries(1, 50, 23)).toBe('Showing 1–23 of 23');
    expect(showingEntries(2, 50, 120)).toBe('Showing 51–100 of 120');
    expect(entriesCsvSuffix('Luis Moreno', '2026-11-16', '2026-11-22')).toBe(
      'for Luis Moreno, Nov 16 to Nov 22',
    );
    expect(entriesFileName('2026-11-16', '2026-11-22')).toBe(
      'foodz-partner-entries-2026-11-16-to-2026-11-22.csv',
    );
  });

  it('checks the range', () => {
    expect(rangeProblems('', '2026-11-22')).toEqual({ from: 'Enter a date.' });
    expect(rangeProblems('2026-11-22', '2026-11-16')).toEqual({
      to: "The end date can't be before the start.",
    });
    expect(rangeProblems('2025-01-01', '2026-11-16')).toEqual({
      to: "The range can't be longer than 366 days.",
    });
    expect(rangeProblems('2026-11-16', '2026-11-22')).toEqual({});
  });
});

describe('the money dialogs (design 3.6 to 3.8)', () => {
  it('previews a cash hand-in from the typed amount', () => {
    expect(cashOutcome('Diego Alvarez', -14_270, 14_270)[0]).toBe(
      'After this, Diego is all square.',
    );
    expect(cashOutcome('Luis Moreno', 6705, 5897)[0]).toBe(
      'After this, Foodz will owe Luis $126.02.',
    );
    expect(cashOutcome('Diego Alvarez', -14_270, 10_000)[0]).toBe(
      'After this, Diego still owes $42.70.',
    );
    expect(cashOutcome('Diego Alvarez', -14_270, null)).toEqual([
      "It can't be edited or deleted. An admin corrects mistakes with an adjustment.",
    ]);
    expect(cashActionLabel(14_270)).toBe('Record $142.70');
    expect(cashActionLabel(null)).toBe('Record cash');
    expect(overHolding('Diego Alvarez', 16_480)).toBe(
      'Diego is holding $164.80, so enter $164.80 or less.',
    );
  });

  it('previews an adjustment', () => {
    expect(
      adjustOutcome(
        'Luis Moreno',
        'add',
        300,
        'Waited 20 min at the kitchen for order 1050.',
        6705,
      ),
    ).toEqual([
      'Luis will see: Foodz added $3.00: Waited 20 min at the kitchen for order 1050.',
      'After this, Foodz will owe Luis $70.05.',
      "It can't be edited or deleted. Correct it with another adjustment.",
    ]);
    expect(adjustOutcome('Luis Moreno', 'take-off', 200, 'Wrong tip', 100)[1]).toBe(
      'After this, Luis will owe Foodz $1.00.',
    );
    expect(adjustActionLabel('add', 300)).toBe('Add $3.00');
    expect(adjustActionLabel('take-off', 200)).toBe('Take off $2.00');
  });

  it('previews a payout', () => {
    expect(payoutOutcome('Luis Moreno', 'bank-transfer', 6705, 6705)).toEqual([
      'Luis will see: Foodz paid you $67.05 · Bank transfer',
      'After this, Foodz will owe Luis $0.00.',
      "It can't be edited or deleted.",
    ]);
    expect(payoutActionLabel(6705)).toBe('Record $67.05 payout');
    expect(overBalance('Luis Moreno', 6705)).toBe(
      'Foodz owes Luis $67.05, so enter $67.05 or less.',
    );
  });

  it('starts the field from cents', () => {
    expect(amountText(14_270)).toBe('142.70');
    expect(amountText(null)).toBe('');
    expect(amountText(0)).toBe('');
  });
});

describe('ratings (design 3.10, 3.11)', () => {
  const row: StaffRatingRow = {
    kind: 'courier',
    id: 'r1',
    at: '2026-11-18T00:20:00Z',
    editedAt: null,
    orderId: 'o1',
    orderNumber: 'S2205',
    customerShort: 'Hana K.',
    subject: 'Grace Okafor',
    stars: 3,
    tags: ['late'],
    comment: null,
    excluded: {
      reason: 'wrong-subject',
      note: null,
      byName: 'Morgan Diaz',
      at: '2026-11-18T10:00:00Z',
    },
    actions: { exclude: false, include: true, readOnlyDemo: false },
  };

  it('words the summary and the spread', () => {
    expect(shownWords(true)).toBe('Shown to customers');
    expect(shownWords(false)).toBe('Not shown to customers until 5 ratings');
    expect(spreadSr(5, 5)).toBe('5 stars: 5 ratings');
    expect(spreadSr(1, 1)).toBe('1 star: 1 rating');
    expect(tagChip({ tag: 'careful-with-food', count: 3 })).toBe('Careful with the food · 3');
  });

  it('words an exclusion and its dialog', () => {
    expect(excludedLine(row)).toBe('Excluded · About the food, not the courier · Morgan Diaz');
    expect(excludeButtonName(row, TZ)).toBe(
      'Exclude from average: 3 stars, Tue, Nov 17, order S2205',
    );
    expect(excludeTitle(row)).toBe("Exclude this rating from Grace Okafor's average?");
    expect(excludeTitle({ kind: 'dish', subject: 'Gimbap' })).toBe(
      "Exclude this Gimbap rating from the dish's average?",
    );
    expect(excludeOutcome(row)[0]).toBe(
      "It stops counting toward Grace's average and tag counts within a minute.",
    );
    expect(excludeOutcome({ kind: 'dish', subject: 'Gimbap' })[0]).toBe(
      "It stops counting toward Gimbap's rating on the menu within a minute.",
    );
    expect(
      excludedLine({
        ...row,
        kind: 'dish',
        excluded: { ...row.excluded!, reason: 'wrong-subject' },
      }),
    ).toBe('Excluded · About the courier, not the food · Morgan Diaz');
  });

  it('shortens a long comment in the dialog', () => {
    expect(commentPreview('x'.repeat(250))).toBe(`${'x'.repeat(200)}…`);
    expect(commentPreview('Cold')).toBe('Cold');
    expect(commentPreview(null)).toBeNull();
  });
});

describe("the order's feedback (design 3.16)", () => {
  it('says why nothing is listed', () => {
    expect(feedbackStateLine({ state: 'open', closesAt: '2026-11-28T00:46:00Z' }, TZ)).toBe(
      'Not rated yet · closes Fri, Nov 27',
    );
    expect(feedbackStateLine({ state: 'skipped', closesAt: null }, TZ)).toBe(
      'Skipped by the customer',
    );
    expect(feedbackStateLine({ state: 'closed', closesAt: null }, TZ)).toBe('Rating closed');
    expect(feedbackStateLine({ state: 'cancelled', closesAt: null }, TZ)).toBe(
      'No ratings for cancelled orders',
    );
    expect(feedbackStateLine({ state: 'rated', closesAt: null }, TZ)).toBeNull();
  });
});
